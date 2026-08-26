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
const SCHEDULE = { 0: 2, 1: 0, 2: 1, 3: 0, 4: 2, 5: 3, 6: 0, 7: 0, 8: 11, 9: 1 };
const BASE_DAYS = 5;
const inBase = Object.entries(SCHEDULE)
  .filter(([d]) => Number(d) < BASE_DAYS)
  .reduce((a, [, n]) => a + n, 0);
const inNext = Object.entries(SCHEDULE)
  .filter(([d]) => Number(d) >= BASE_DAYS)
  .reduce((a, [, n]) => a + n, 0);

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

/** One scheduled fixture, in the shape the live endpoint really returns. */
const event = (offset, i) => {
  const start = dayAt(offset);
  start.setHours(19, 0, 0, 0);
  const iso = start.toISOString();
  const id = `${offset}${String(i).padStart(2, "0")}`;
  return {
    id,
    date: iso,
    name: `Team A${id} at Team H${id}`,
    shortName: `A${id} @ H${id}`,
    status: {
      clock: 0,
      displayClock: "0:00",
      period: 0,
      type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false },
    },
    competitions: [
      {
        id,
        date: iso,
        competitors: [
          { id: `h${id}`, homeAway: "home", team: team(`h${id}`, `Home ${id}`, "HOM"), score: "0" },
          { id: `a${id}`, homeAway: "away", team: team(`a${id}`, `Away ${id}`, "AWY"), score: "0" },
        ],
        status: {
          clock: 0,
          displayClock: "0:00",
          period: 0,
          type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false },
        },
        broadcasts: [{ market: "national", names: ["ESPN"] }],
      },
    ],
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
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(dates.includes("-") ? { events: [] } : boardFor(dates)),
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
    JSON.stringify({ v: 1, data: { leagues: ["football/college-football"], teams: [] } }),
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
check("the board opens on five days, not three",
  baseDays.length === Object.entries(SCHEDULE).filter(([d, n]) => Number(d) < BASE_DAYS && n > 0).length,
  `${baseDays.length} day headings: ${baseDays.join(", ")}`);
check("empty days inside the window render nothing at all",
  baseDays.length === new Set(baseDays).size && baseDays.length === 3,
  baseDays.join(", "));
check("and it asked per day, not as one range", asked >= BASE_DAYS, `${asked} requests`);

const moreBtn = page.locator(".sports__morebtn");
check("a Show more control is offered", (await moreBtn.count()) === 1);

const before = base.cards;
await moreBtn.click();
await page.waitForTimeout(2500);
const after = await board();
const afterDays = after.headings.filter((h) => !/Today.s Games/i.test(h));

check("Show more adds the next five days", afterDays.length > baseDays.length,
  `${baseDays.length} -> ${afterDays.length} day headings`);
// THE ONE THAT MATTERS. Eleven games on day eight, all of them, where the
// old window handed back the two the reach happened to answer with.
check("the day eight out lands its WHOLE slate",
  after.cards - before === inNext, `+${after.cards - before} cards, expected +${inNext}`);
check("  and that is more than the reach ever returned", inNext > 2, `${inNext} games`);
check("nothing from the base window was dropped", after.cards >= before,
  `${before} -> ${after.cards}`);
check("the base window's own count is right", before === inBase,
  `${before} cards, expected ${inBase}`);

if (process.env.SHOT_DIR)
  await page.screenshot({ path: `${process.env.SHOT_DIR}/sports-days.png` });
await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
