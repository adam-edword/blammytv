// Headless verify: THE SPORTS BOARD'S DAY WINDOW AND ITS "SHOW MORE".
//
// The bug this locks down: on a league-filtered board, a day eight out
// showed two of eleven games. The window only ever asked for three days,
// so everything past that fell to the REACH — and the reach answers with a
// league's NEXT fixture, not its slate. Two games was two answers to a
// different question, not a partial load, which is why it looked like a
// data problem rather than a window one.
//
// ESPN IS ROUTED, not called. The board asks per DAY per league, so the
// fixture is a schedule keyed by day offset and the assertions are counts
// against it. Real payload shape (captured from the live endpoint) so the
// parser is genuinely exercised; synthetic dates so the harness does not
// depend on what happens to be on this week.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-sports-days.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

/**
 * Games per day offset from today.
 *
 * Day 8 carries the slate that started this: a Thursday with a full card on
 * it, well past the old three-day window. Days 1, 3, 6 and 7 are empty on
 * purpose — college football really is clustered, and an empty day must
 * render as nothing at all rather than as a bare heading.
 *
 * DAY 4 IS LOAD-BEARING. It is inside the five-day window and outside the
 * old three-day one, so it is what makes the opening-width check able to
 * fail. Without a game there both windows show the same two days and the
 * check passes against the very code it exists to catch.
 */
const SCHEDULE = {
  // NEGATIVE OFFSETS ARE YESTERDAY AND THE DAY BEFORE, and nothing fetches
  // them until "Show earlier days" is clicked. They are in the fixture so
  // that a board which has NOT been asked can be told apart from one that
  // was asked and got nothing: without games back there, a broken button
  // and a working one look identical.
  "-2": 4, "-1": 3,
  // FOUR TODAY, not two, and their states are mixed (see FINALS). Two is
  // enough to prove a day rendered and not enough to prove anything about
  // the ORDER within it.
  0: 4, 1: 0, 2: 1, 3: 0, 4: 2,
  5: 3, 6: 0, 7: 0, 8: 11, 9: 1,
  // Past the first chunk, so a click has somewhere to stop. One click is
  // worth 50 GAMES now, not five days, and 3+11+1+18+20 walks past that.
  10: 0, 11: 18, 12: 0, 13: 20, 14: 6,
};
const BASE_DAYS = 5;
/** How far back the board may be walked. Mirrors EARLIER_DAYS in useGames;
 * the fixture only carries two of them, which is the point of the cap
 * check below. */
const EARLIER_DAYS = 3;
/**
 * WHICH of a day's games have finished, by index.
 *
 * Today's finals are at 0 and 2, INTERLEAVED with the two that have not
 * kicked off. That is Adam's complaint made reproducible: in kick-off
 * order a compacted board draws pill, card, pill, card, and the full-height
 * card in the middle of a run of one-liners is the hole being fixed. Two
 * finals in a row would pass against the very code this exists to catch.
 */
const FINALS = { 0: [0, 2], "-1": [0, 1, 2], "-2": [0, 1, 2, 3] };
const inBase = Object.entries(SCHEDULE)
  .filter(([d]) => Number(d) >= 0 && Number(d) < BASE_DAYS)
  .reduce((a, [, n]) => a + n, 0);
/**
 * What one click is worth.
 *
 * Modelled in BATCHES of BASE_DAYS, because that is what loadMore does: it
 * fetches a batch in parallel and only then asks whether it has enough. So
 * it overshoots the target by whatever the last batch happened to hold, and
 * a day-by-day model here reads that correct behaviour as a bug (it did,
 * at +59 against an expected +53).
 */
const MORE_GAMES = 50;
let acc = 0;
let lastDay = BASE_DAYS - 1;
for (let start = BASE_DAYS; acc < MORE_GAMES; start += BASE_DAYS) {
  let any = false;
  for (let d = start; d < start + BASE_DAYS; d++) {
    if (!(d in SCHEDULE)) continue;
    acc += SCHEDULE[d];
    lastDay = d;
    any = true;
  }
  if (!any) break;
}
const inNext = acc;

/** The sparse league's one reached-ahead fixture, which lands on its own
 * day heading rather than in a bucket. It is on the board from the start,
 * so every count below has to allow for it. */
const REACHED = 1;

const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const dayAt = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const team = (id, name, abbr) => ({
  id: String(id),
  location: name,
  name,
  abbreviation: abbr,
  displayName: name,
  shortDisplayName: name,
  logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`,
});

/** Has this day's i-th game finished? See FINALS. */
const isFinal = (offset, i) => (FINALS[String(offset)] ?? []).includes(i);

/**
 * One fixture, in the shape the live endpoint really returns.
 *
 * KICK-OFF TIMES SPREAD ACROSS THE DAY on the days whose states are mixed,
 * because a reordering check needs an order to disturb. Everywhere else
 * they stay at 19:00, which is what the rest of this file was written
 * against.
 */
const event = (offset, i) => {
  const start = dayAt(offset);
  start.setHours(FINALS[String(offset)] ? 12 + i : 19, 0, 0, 0);
  const iso = start.toISOString();
  const id = `${offset}${String(i).padStart(2, "0")}`;
  const done = isFinal(offset, i);
  const status = done
    ? {
        clock: 0,
        displayClock: "0:00",
        period: 4,
        type: {
          id: "3",
          name: "STATUS_FINAL",
          state: "post",
          completed: true,
          shortDetail: "Final",
        },
      }
    : {
        clock: 0,
        displayClock: "0:00",
        period: 0,
        type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false },
      };
  return {
    id,
    date: iso,
    name: `Team A${id} at Team H${id}`,
    shortName: `A${id} @ H${id}`,
    status,
    competitions: [
      {
        id,
        date: iso,
        competitors: [
          {
            id: `h${id}`,
            homeAway: "home",
            team: team(`h${id}`, `Home ${id}`, "HOM"),
            score: done ? "24" : "0",
          },
          {
            id: `a${id}`,
            homeAway: "away",
            team: team(`a${id}`, `Away ${id}`, "AWY"),
            score: done ? "17" : "0",
          },
        ],
        status,
        broadcasts: [{ market: "national", names: ["ESPN"] }],
      },
    ],
  };
};

/**
 * A league with NOTHING in the window and one fixture far out.
 *
 * This is what makes the "no Coming up pile" check mean something. That
 * section only ever rendered when the REACH answered, and the reach only
 * fires for a followed league that put nothing on the board — so with one
 * densely-scheduled league in the fixture there was never anything to pile
 * up, and the check passed against code that still had the pile in it.
 *
 * The reach asks as a RANGE (`dates=A-B`), which is how it is told apart
 * from the window's per-day asks below.
 */
const SPARSE = "basketball/nba";
const SPARSE_DAY = 40;
const sparseAhead = () => {
  const e = event(SPARSE_DAY, 0);
  e.id = "sparse-1";
  e.competitions[0].id = "sparse-1";
  return {
    leagues: [{ id: "46", name: "NBA", abbreviation: "NBA", slug: "nba" }],
    events: [e],
  };
};

const boardFor = (dates) => {
  // The board asks one day at a time, so `dates` is a single YYYYMMDD.
  let events = [];
  for (const [offset, n] of Object.entries(SCHEDULE)) {
    if (ymd(dayAt(Number(offset))) !== dates) continue;
    events = Array.from({ length: n }, (_, i) => event(Number(offset), i));
  }
  return {
    leagues: [{ id: "23", name: "NCAA Football", abbreviation: "NCAAF", slug: "college-football" }],
    events,
  };
};

const PLAYLIST = {
  v: 1,
  data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }],
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 } })
).newPage();

// Everything ESPN: the scoreboard answers from SCHEDULE, the logo CDN
// answers with nothing so a hundred image requests do not hang the run.
let asked = 0;
await page.route(/site\.api\.espn\.com/, async (route) => {
  asked++;
  const url = new URL(route.request().url());
  const dates = url.searchParams.get("dates") ?? "";
  const sparse = url.pathname.includes(SPARSE);
  // The league reach asks with NO dates param at all — that bare call is
  // what makes ESPN hand back a league's next fixture. The club reach asks
  // as a range. The window asks one day at a time. Only the first two are
  // the reach, and testing for a range alone missed the one that matters.
  const isReach = dates === "" || dates.includes("-");
  const body = isReach
    ? sparse
      ? sparseAhead()
      : { events: [] }
    : sparse
      ? { events: [] }
      : boardFor(dates);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});
await page.route(/a\.espncdn\.com/, (route) => route.abort());

await page.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  sessionStorage.setItem("btv:welcome-played", "1");
  // A league follow is what narrows the board, and a narrowed board is the
  // one that opens on five days.
  localStorage.setItem(
    "blammytv.sports-follows",
    JSON.stringify({
      v: 1,
      data: { leagues: ["football/college-football", "basketball/nba"], teams: [] },
    }),
  );
}, PLAYLIST);

await page.goto(process.env.APP_URL ?? "http://localhost:4173/", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector(".navcap", { timeout: 20_000 });
await page.locator('[data-dest="sports"]').click();
await page.waitForSelector(".sports__grid", { timeout: 20_000 });
await page.waitForTimeout(1500);

const board = () =>
  page.evaluate(() => ({
    headings: [...document.querySelectorAll(".sports__title")].map((e) =>
      e.textContent.replace(/\s+/g, " ").trim(),
    ),
    cards: document.querySelectorAll(".sports__grid > *").length,
  }));

const base = await board();
// "Today's Games" is a row of its own above the day grids and repeats
// day 0, so the day sections are what is left after it.
const baseDays = base.headings.filter((h) => !/Today.s Games/i.test(h));
const windowDays = Object.entries(SCHEDULE).filter(
  ([d, n]) => Number(d) >= 0 && Number(d) < BASE_DAYS && n > 0,
).length;
check("the board opens on five days, not three",
  baseDays.length === windowDays + REACHED,
  `${baseDays.length} day headings: ${baseDays.join(", ")}`);
check("empty days inside the window render nothing at all",
  baseDays.length === new Set(baseDays).size &&
    baseDays.length === windowDays + REACHED,
  baseDays.join(", "));
check("and it asked per day, not as one range", asked >= BASE_DAYS, `${asked} requests`);

// ---- COMPACTION PUTS THE RESULTS FIRST (Adam's) ----------------------
//
// Today is pill, card, pill, card in kick-off order. Compaction is on by
// default, so what should render is both pills then both cards. The check
// reads the CLASSES in DOM order rather than counting, because counting
// cannot tell "grouped" from "interleaved" — which is the entire bug.
const todayKinds = () =>
  page.evaluate(() =>
    [...(document.querySelectorAll(".sports__grid")[0]?.children ?? [])].map(
      (el) =>
        el.classList.contains("compactcard")
          ? "final"
          : el.classList.contains("upcard")
            ? "open"
            : "other",
    ),
  );
const kinds = await todayKinds();
check(
  "today's grid draws four cards",
  kinds.length === SCHEDULE[0],
  `${kinds.length}: ${kinds.join(", ")}`,
);
check(
  "compacted results are grouped at the front, not left where they kicked off",
  kinds.join(",") === "final,final,open,open",
  kinds.join(", "),
);

// Turning compaction OFF must put kick-off order back: every card is the
// same size then, so there is nothing to group and grouping would be a
// reordering nobody asked for.
// NOT `.sports__toggle` first(): the row's Hide finished pill wears that
// class too and the row is ABOVE the day grids, so first() is the pill.
const compactBtn = page
  .locator(".sports__toggle:not(.sports__toggle--pill)")
  .first();
await compactBtn.click();
await page.waitForTimeout(400);
const loose = await todayKinds();
check(
  "and with compaction off it is kick-off order again",
  loose.join(",") === "open,open,open,open",
  loose.join(", "),
);
await compactBtn.click();
await page.waitForTimeout(400);

// ---- THE ROW'S "HIDE FINISHED" PILL (Adam's) -------------------------
const rowCards = () =>
  page.evaluate(
    () => document.querySelectorAll(".media-row__scroller .gamecard").length,
  );
const pill = page.locator(".sports__toggle--pill");
check("the row offers a Hide finished pill", (await pill.count()) === 1);
const rowBefore = await rowCards();
check(
  "the row carries every fixture today, finished included",
  rowBefore === SCHEDULE[0],
  `${rowBefore} cards`,
);
await pill.click();
await page.waitForTimeout(400);
const rowAfter = await rowCards();
check(
  "the pill drops the finished ones from the row",
  rowAfter === SCHEDULE[0] - FINALS["0"].length,
  `${rowBefore} -> ${rowAfter} cards`,
);
check(
  "and the grids below still carry them",
  (await todayKinds()).filter((k) => k === "final").length ===
    FINALS["0"].length,
  "hiding is a row control, not a board one",
);
await pill.click();
await page.waitForTimeout(400);
check(
  "turning it back off restores the row",
  (await rowCards()) === rowBefore,
  `${await rowCards()} cards`,
);

// ---- WALKING BACKWARDS (Adam's) --------------------------------------
//
// Nothing is fetched behind today until this is clicked, so the check that
// matters is that yesterday's games were NOT on the board first.
const early = page.locator(".sports__more--earlier .sports__morebtn");
check("a Show earlier days control is offered", (await early.count()) === 1);
const headingsNow = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".sports__title")]
      .map((e) => e.textContent.replace(/\s+/g, " ").trim())
      .filter((h) => !/Today.s Games/i.test(h)),
  );
check(
  "yesterday is not on the board until it is asked for",
  !(await headingsNow()).some((h) => /Yesterday/i.test(h)),
  (await headingsNow()).join(", "),
);
const cardsBeforeBack = (await board()).cards;
await early.click();
await page.waitForTimeout(2000);
const backOne = await board();
check(
  "one click brings yesterday back",
  backOne.cards - cardsBeforeBack === SCHEDULE["-1"],
  `+${backOne.cards - cardsBeforeBack} cards, expected +${SCHEDULE["-1"]}`,
);
// ABOVE today, not appended. The board sorts by date, so this is really a
// check that the prepended day went through the same sort as the rest.
const order = await headingsNow();
check(
  "and it lands above today rather than at the end",
  order.findIndex((h) => /^Today$/i.test(h)) > 0,
  order.join(" | "),
);
// The cap is three, and the fixture holds two. So click until it goes
// away, and prove it goes away at the cap rather than running forever.
let clicks = 1;
while ((await early.count()) === 1 && clicks < 6) {
  await early.click();
  await page.waitForTimeout(1500);
  clicks++;
}
check(
  "it stops at the cap instead of walking back forever",
  clicks === EARLIER_DAYS && (await early.count()) === 0,
  `${clicks} clicks, control ${(await early.count()) === 0 ? "gone" : "still there"}`,
);
check(
  "and the day before yesterday came with it",
  (await board()).cards - cardsBeforeBack ===
    SCHEDULE["-1"] + SCHEDULE["-2"],
  `+${(await board()).cards - cardsBeforeBack} cards`,
);

const moreBtn = page.locator(".sports__morebtn");
check("a Show more control is offered", (await moreBtn.count()) === 1);

/** The board's own opening count, for the base-window check further down.
 * It is NOT what the "Show more" delta is measured against any more: the
 * backwards walk above has since put two days on the board. */
const before = base.cards;
const beforeMore = (await board()).cards;
await moreBtn.click();
await page.waitForTimeout(2500);
const after = await board();
const afterDays = after.headings.filter((h) => !/Today.s Games/i.test(h));

check("Show more adds more days", afterDays.length > baseDays.length,
  `${baseDays.length} -> ${afterDays.length} day headings`);
check("one click is worth about fifty games, not a fixed five days",
  inNext >= MORE_GAMES && lastDay > BASE_DAYS + 4,
  `${inNext} games, walked to day ${lastDay}`);
// THE ONE THAT MATTERS. Eleven games on day eight, all of them, where the
// old window handed back the two the reach happened to answer with.
check("the day eight out lands its WHOLE slate",
  after.cards - beforeMore === inNext,
  `+${after.cards - beforeMore} cards, expected +${inNext}`);
// The reach answered with a fixture forty days out. It must appear, and it
// must appear under a DAY, not in a bucket after the grids.
const reached = await page.evaluate(() => {
  const titles = [...document.querySelectorAll(".sports__title")].map((e) =>
    e.textContent.replace(/\s+/g, " ").trim(),
  );
  const cards = [...document.querySelectorAll(".sports__grid")].flatMap((g) =>
    [...g.children].map((c) => c.textContent),
  );
  return {
    hasPile: /Coming up/i.test(document.body.innerText),
    titles,
    sparseShown: cards.some((t) => /4000/.test(t ?? "")),
  };
});
check("the reached-ahead fixture is on the board at all", reached.sparseShown,
  reached.sparseShown ? "" : "the sparse league's game never rendered");
check("and it sits under a day, with no Coming up pile", !reached.hasPile,
  reached.titles.join(" | ").slice(0, 160));
check("cards name their weekday beside the date",
  await page.evaluate(() =>
    [...document.querySelectorAll(".upcard__when")].some((e) =>
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(e.textContent.trim()))),
  await page.evaluate(() =>
    document.querySelector(".upcard__when")?.textContent?.trim() ?? "no date on any card"));
check("  and that is more than the reach ever returned", inNext > 2, `${inNext} games`);
check("nothing from the base window was dropped", after.cards >= before,
  `${before} -> ${after.cards}`);
check("the base window's own count is right", before === inBase + REACHED,
  `${before} cards, expected ${inBase + REACHED}`);

if (process.env.SHOT_DIR)
  await page.screenshot({ path: `${process.env.SHOT_DIR}/sports-days.png` });
await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
