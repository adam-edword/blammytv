// Headless verify: CLASSIC'S SPORTS TAB (plan 035, "Classic across the app").
//
// With the Classic pack on, the Sports tab is a leagues tree, each day a
// group box and each game a raised panel with a green score display. With
// Default back, the board is the one it always was. What this proves:
//
// - Classic: days are fieldsets captioned "Today" and "Tomorrow"; games are
//   panels, away team first in a US sport, each with a colour block from the
//   team's colour; the score sits in a sunken black display in a monospace
//   face and the green token, dim dashes before kick-off; the state reads
//   "4th 2:31" / "Final" / a time; the live line reads "Live on 2 channels"
//   as a blue underlined label; a panel is a raised square-cornered Tahoma
//   box; a click opens the game's theater like the card it stands in for.
// - The tree: tree / treeitem roles with aria-expanded, a closed sport opens
//   from its box, a league click picks it and narrows the board to it, Clear
//   Filter undoes that, and the arrow keys, Right, Left and Enter all work.
// - Default: the same page with the pack off draws no panel, no group box
//   and no tree, and has its section headings and league picker back.
//
// ESPN is routed (NFL and NBA scoreboards, so a pick has something to
// narrow), every other host aborted. Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-classic-sports.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const dayAt = (offset, hour) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

const team = (id, name, abbr, color) => ({
  id: String(id),
  location: name,
  name,
  abbreviation: abbr,
  displayName: name,
  shortDisplayName: name,
  color,
});
const STATE = {
  pre: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false } },
  live: { clock: 151, displayClock: "2:31", period: 4, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "4th 2:31" } },
  final: { clock: 0, displayClock: "0:00", period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } },
};
/** One scoreboard event. Home is listed second, as ESPN does. */
const event = (id, when, st, home, away, scores, broadcasts) => ({
  id,
  date: when.toISOString(),
  name: `${away.name} at ${home.name}`,
  status: STATE[st],
  competitions: [
    {
      id,
      date: when.toISOString(),
      competitors: [
        { id: `h${id}`, homeAway: "home", team: home, score: String(scores[0]) },
        { id: `a${id}`, homeAway: "away", team: away, score: String(scores[1]) },
      ],
      status: STATE[st],
      broadcasts: broadcasts ? [{ market: "national", names: broadcasts }] : [],
    },
  ],
});

// NFL: a live game on two of the fake line's channels, a final, a game still
// to come (nothing on it), and one tomorrow. NBA: one game, to be narrowed away.
const RED = "c0392b";
const BLUE = "1f6fb2";
const NFL = [
  event("n1", dayAt(0, 12), "live", team("h1", "Lions", "DET", BLUE), team("a1", "Bears", "CHI", RED), [14, 21], ["Fake Sky Sports", "ESPN"]),
  event("n2", dayAt(0, 9), "final", team("h2", "Cowboys", "DAL", "003594"), team("a2", "Seahawks", "SEA", "69be28"), [3, 7], ["ESPN"]),
  event("n3", dayAt(0, 23), "pre", team("h3", "Dolphins", "MIA", "008e97"), team("a3", "Broncos", "DEN", "fb4f14"), [0, 0], null),
  event("n4", dayAt(1, 15), "pre", team("h4", "Giants", "NYG", "0b2265"), team("a4", "Celtics", "BOS", "000000"), [0, 0], null),
];
const NBA = [event("b1", dayAt(0, 20), "pre", team("h5", "Knicks", "NYK", "006bb6"), team("a5", "Heat", "MIA", "98002e"), [0, 0], null)];
const BOARDS = {
  "football/nfl": { leagues: [{ id: "28", name: "NFL", abbreviation: "NFL", slug: "nfl" }], events: NFL },
  "basketball/nba": { leagues: [{ id: "46", name: "NBA", abbreviation: "NBA", slug: "nba" }], events: NBA },
};

const PLAYLIST = {
  v: 1,
  data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }],
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("pageerror", (e) => check("no page error", false, String(e)));

// ESPN answers from the boards by day; anything else off the machine is aborted.
await page.route(/site\.api\.espn\.com/, async (route) => {
  const url = new URL(route.request().url());
  const dates = url.searchParams.get("dates") ?? "";
  const path = Object.keys(BOARDS).find((p) => url.pathname.includes(`/${p}/`));
  const board = path ? BOARDS[path] : { events: [] };
  const events = dates.length === 8 ? board.events.filter((e) => ymd(new Date(e.date)) === dates) : [];
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...board, events }) });
});
await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => (route.request().url().includes("site.api.espn.com") ? route.fallback() : route.abort()));

await page.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.sports-follows",
    JSON.stringify({ v: 1, data: { leagues: ["football/nfl", "basketball/nba"], teams: [] } }),
  );
}, PLAYLIST);

await page.goto(process.env.APP_URL ?? "http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".navcap", { timeout: 20_000 });
await goTo(page, "sports");
await page.waitForSelector(".sports__grid", { timeout: 20_000 });
await page.waitForSelector(".upcard", { timeout: 20_000 }); // the board has loaded

const setPack = (on) =>
  page.evaluate((on) => {
    if (on) document.documentElement.dataset.themePack = "classic";
    else delete document.documentElement.dataset.themePack;
  }, on);

// The board re-filters when a tree pick lands, and a fixed sleep guessed how
// long that takes. These wait for the board itself: the game panels drawn, or
// the compact ones, are the count the pick should have made.
const boardHas = (n) => page.waitForFunction((n) => document.querySelectorAll(".cl-game").length === n, n, { timeout: 10_000 });
const compactHas = (n) => page.waitForFunction((n) => document.querySelectorAll(".cl-game--compact").length === n, n, { timeout: 10_000 });
// What the seeded boards hold: NFL 3 today and 1 tomorrow, NBA 1 today.
const ALL = 5;
const NFL_ONLY = 4;
const NBA_ONLY = 1;

// ---------------------------------------------------------------- Default first
check(
  "Default: section headings, cards and the league picker, no Classic parts",
  (await page.locator(".cl-game, .cl-sports__day, .cl-tv").count()) === 0 &&
    (await page.locator(".upcard").count()) > 0 &&
    (await page.locator(".leaguepick").count()) === 1 &&
    (await page.locator("section.media-row .sports__title").count()) > 0,
);

// ---------------------------------------------------------------- Classic on
await setPack(true);
await page.waitForSelector(".cl-game", { timeout: 10_000 });
// Compaction is on by default and squeezes the final to a line; turn it off so
// every panel is the full one, and check the line afterwards.
const compactBtn = page.locator(".cl-sports__day .sports__toggle").first();
const compactedFinal = await page.locator(".cl-game--compact").count();
await compactBtn.click();
await compactHas(0);

check(
  "Classic: the board is Classic's, with no Default card or row",
  (await page.locator(".cl-sports").count()) === 1 &&
    (await page.locator(".upcard, .compactcard, .gamecard, .media-row__scroller").count()) === 0,
);
check("Compact Results made the final one line before it was switched off", compactedFinal === 1, String(compactedFinal));

const days = await page.evaluate(() =>
  [...document.querySelectorAll("fieldset.cl-sports__day")].map((f) => ({
    legend: f.querySelector(":scope > legend")?.textContent,
    games: f.querySelectorAll(".cl-game").length,
    border: getComputedStyle(f).borderTopWidth,
  })),
);
check(
  "each day is a group box captioned Today then Tomorrow",
  days.length === 2 && days[0].legend === "Today" && days[1].legend === "Tomorrow" && days.every((d) => d.border === "1px"),
  JSON.stringify(days),
);
check("Today holds four games (NBA included) and Tomorrow one", days[0].games === 4 && days[1].games === 1, JSON.stringify(days.map((d) => d.games)));

// One panel's parts, by game id.
const panel = (id) =>
  page.evaluate((id) => {
    const el = document.querySelector(`.cl-game[data-game$="-${id}"]`);
    if (!el) return null;
    const led = el.querySelector(".cl-game__led");
    const link = el.querySelector(".cl-game__link");
    const cs = getComputedStyle(el);
    const lcs = led && getComputedStyle(led);
    return {
      names: [...el.querySelectorAll(".cl-game__name")].map((n) => n.textContent),
      swatches: [...el.querySelectorAll(".cl-game__swatch")].map((s) => getComputedStyle(s).backgroundColor),
      at: el.querySelector(".cl-game__at")?.textContent,
      led: led?.textContent,
      ledOff: led?.classList.contains("cl-game__led--off"),
      ledColor: lcs?.color,
      ledFont: lcs?.fontFamily,
      ledBg: lcs?.backgroundColor,
      ledShadow: lcs?.boxShadow,
      state: el.querySelector(".cl-game__state")?.textContent.trim(),
      link: link?.textContent,
      linkColor: link && getComputedStyle(link).color,
      linkUnderline: link && getComputedStyle(link).textDecorationLine,
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
      font: cs.fontFamily,
      disabled: el.disabled,
    };
  }, id);

const live = await panel("n1");
const done = await panel("n2");
const pre = await panel("n3");
check("the teams read away first, with 'at' between", live?.names.join() === "Bears,Lions" && live.at === "at", JSON.stringify(live?.names));
check(
  "each team has a colour block from its colour",
  live?.swatches.join() === "rgb(192, 57, 43),rgb(31, 111, 178)",
  live?.swatches.join(" | "),
);
check("the live score is in the display, away first", live?.led === "21 - 14", live?.led);
check(
  "the display is black, monospace, sunken and green",
  live?.ledBg === "rgb(0, 0, 0)" && /mono|courier/i.test(live.ledFont) && live.ledColor === "rgb(0, 255, 64)" && /inset/.test(live.ledShadow),
  JSON.stringify({ bg: live?.ledBg, font: live?.ledFont, color: live?.ledColor }),
);
check("a game still to come shows dim dashes", pre?.led === "- - -" && pre.ledOff && pre.ledColor !== "rgb(0, 255, 64)", JSON.stringify({ led: pre?.led, color: pre?.ledColor }));
check("the final's score and state", done?.led === "7 - 3" && done.state === "Final", JSON.stringify({ led: done?.led, state: done?.state }));
check("the live state is the clock", live?.state === "4th 2:31", live?.state);
check("an upcoming game's state is its time", /\d{1,2}:\d{2}/.test(pre?.state ?? ""), pre?.state);
check(
  "the live line says Live on 2 channels, as a blue underlined label",
  live?.link === "Live on 2 channels" && live.linkColor === "rgb(0, 0, 255)" && live.linkUnderline === "underline",
  JSON.stringify({ link: live?.link, color: live?.linkColor }),
);
check("a game with no channel says so without the link look", pre?.linkUnderline === "none", pre?.link);
check(
  "a panel is raised, square and Tahoma",
  live?.radius === "0px" && /inset/.test(live.shadow) && /Tahoma/.test(live.font),
  JSON.stringify({ r: live?.radius, f: live?.font }),
);

// Compact Results back on: the final is a one-line panel again.
await compactBtn.click();
await compactHas(1);
check("Compact Results still compacts the final", (await page.locator(".cl-game--compact").count()) === 1);
await compactBtn.click();
await compactHas(0);

// ---------------------------------------------------------------- the tree
const tree = page.locator('[role="tree"]');
check(
  "the leagues are a tree with a Sports root and a folder per sport, closed",
  (await tree.count()) === 1 &&
    (await tree.locator('[role="treeitem"]').first().getAttribute("aria-expanded")) === "true" &&
    (await tree.locator('li[data-id^="s:"]').count()) > 5,
);
// The sports holding a followed league start open.
check(
  "the sports holding a followed league start open",
  (await page.locator('li[data-id="s:football"]').getAttribute("aria-expanded")) === "true" &&
    (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "false",
);
await page.locator('li[data-id="s:soccer"] > .cl-tv__n > .cl-tv__bx').click();
check(
  "a closed sport opens from its +/- box and lists its leagues",
  (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "true" &&
    (await page.locator('li[data-id="s:soccer"] li[role="treeitem"]').count()) > 5,
);
check(
  "the box only opens it: nothing is selected, the Sports root still is",
  (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-selected")) === "false" &&
    (await page.locator('li[data-id="root"]').getAttribute("aria-selected")) === "true",
);
await page.locator('li[data-id="s:soccer"] > .cl-tv__n > .cl-tv__bx').click();
check("and closes again", (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "false");
await page.locator('li[data-id="s:soccer"] > .cl-tv__n .cl-tv__lb').dblclick();
check("a double click on the label opens it too", (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "true");
await page.locator('li[data-id="s:soccer"] > .cl-tv__n .cl-tv__lb').dblclick();
check("and closes it", (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "false");
await page.locator('li[data-id="root"] > .cl-tv__n .cl-tv__lb').click(); // back to a clean filter: the dblclicks selected Soccer
await boardHas(ALL);
check(
  "tree labels are 12px on 18px rows",
  await page.evaluate(() => {
    const lb = document.querySelector('li[data-id="s:football"] > .cl-tv__n .cl-tv__lb');
    const n = lb.closest(".cl-tv__n");
    return getComputedStyle(lb).fontSize === "12px" && n.getBoundingClientRect().height === 18;
  }),
);

const games = () => page.locator(".cl-game").count();
const before = await games();
await page.locator('li[data-id="l:football/nfl"] > .cl-tv__n').click();
await boardHas(NFL_ONLY);
const nflSel = await page.locator('li[data-id="l:football/nfl"]').getAttribute("aria-selected");
const namesAfter = await page.locator(".cl-game__name").allTextContents();
check("a league click selects it", nflSel === "true");
check(
  "and narrows the board to it: the NBA game is gone, the NFL's stay",
  before === ALL && namesAfter.length > 0 && !namesAfter.includes("Heat") && namesAfter.includes("Bears"),
  `${before} -> ${await games()}: ${namesAfter.join(",")}`,
);
check(
  "the selected league is navy with white text",
  await page.evaluate(() => {
    const lb = document.querySelector('li[data-id="l:football/nfl"] .cl-tv__lb');
    const cs = getComputedStyle(lb);
    return cs.backgroundColor === "rgb(10, 36, 106)" && cs.color === "rgb(255, 255, 255)";
  }),
);
await page.getByRole("button", { name: /Clear Filter/ }).click();
await boardHas(ALL);
check(
  "Clear Filter brings the whole board back",
  (await games()) === before && (await page.locator('li[data-id="l:football/nfl"]').getAttribute("aria-selected")) === "false",
);

// Explorer's rule for the folders: a click on a LABEL selects, it does not fold.
const games0 = await games();
const open0 = await page.locator('li[data-id="s:basketball"]').getAttribute("aria-expanded");
await page.locator('li[data-id="s:basketball"] > .cl-tv__n .cl-tv__lb').click();
await boardHas(NBA_ONLY);
const hoops = await page.locator(".cl-game__name").allTextContents();
check(
  "a sport label selects it: aria-selected, navy, and the board narrows to that sport's leagues",
  (await page.locator('li[data-id="s:basketball"]').getAttribute("aria-selected")) === "true" &&
    hoops.join() === "Heat,Knicks" &&
    (await page.evaluate(() => getComputedStyle(document.querySelector('li[data-id="s:basketball"] > .cl-tv__n .cl-tv__lb')).backgroundColor)) === "rgb(10, 36, 106)",
  hoops.join(),
);
check(
  "and does not toggle it",
  (await page.locator('li[data-id="s:basketball"]').getAttribute("aria-expanded")) === open0,
  open0,
);
check(
  "the root is not selected while a sport is",
  (await page.locator('li[data-id="root"]').getAttribute("aria-selected")) === "false" &&
    (await page.locator('li[data-id="s:football"]').getAttribute("aria-selected")) === "false",
);
await page.locator('li[data-id="s:basketball"] > .cl-tv__n > .cl-tv__bx').click();
check(
  "the +/- box toggles it and leaves the selection alone",
  (await page.locator('li[data-id="s:basketball"]').getAttribute("aria-expanded")) !== open0 &&
    (await page.locator('li[data-id="s:basketball"]').getAttribute("aria-selected")) === "true",
);
await page.locator('li[data-id="s:basketball"] > .cl-tv__n > .cl-tv__bx').click(); // as it was
await page.locator('li[data-id="s:football"] > .cl-tv__n .cl-tv__lb').click();
await boardHas(NFL_ONLY);
// "No Heat" also holds for an empty board, so the board must be the new
// sport's: not empty, and a football game on it.
const footNames = await page.locator(".cl-game__name").allTextContents();
check(
  "another sport label replaces the selection",
  (await page.locator('li[data-id="s:basketball"]').getAttribute("aria-selected")) === "false" &&
    (await page.locator('li[data-id="s:football"]').getAttribute("aria-selected")) === "true" &&
    footNames.length > 0 &&
    footNames.includes("Bears") &&
    !footNames.includes("Heat"),
  footNames.join(),
);
await page.locator('li[data-id="root"] > .cl-tv__n .cl-tv__lb').click();
await boardHas(ALL);
check(
  "the Sports label clears the filter: everything is back and the root is the selection",
  (await games()) === games0 &&
    (await page.locator('li[data-id="root"]').getAttribute("aria-selected")) === "true" &&
    (await page.locator('li[data-id="s:football"]').getAttribute("aria-selected")) === "false",
);
check(
  "and a click on it does not fold the tree",
  (await page.locator('li[data-id="root"]').getAttribute("aria-expanded")) === "true",
);
await page.locator('li[data-id="s:basketball"]').focus();
await page.keyboard.press("Enter");
await boardHas(NBA_ONLY);
check(
  "Enter on a sport selects it",
  (await page.locator('li[data-id="s:basketball"]').getAttribute("aria-selected")) === "true" &&
    (await page.locator(".cl-game__name").allTextContents()).join() === "Heat,Knicks",
);
await page.locator('li[data-id="root"]').focus();
await page.keyboard.press("Enter");
await boardHas(ALL);
check("and Enter on Sports clears it", (await games()) === games0);

// Keyboard: the root takes the tab stop, arrows walk, Right opens, Enter picks.
await page.locator('li[data-id="root"]').focus();
await page.keyboard.press("ArrowDown");
const first = await page.evaluate(() => document.activeElement?.dataset.id);
check("ArrowDown moves to the first sport", /^s:/.test(first ?? ""), first);
await page.locator('li[data-id="s:soccer"]').focus();
await page.keyboard.press("ArrowRight");
check("Right opens a closed folder", (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "true");
await page.keyboard.press("ArrowRight");
const into = await page.evaluate(() => document.activeElement?.dataset.id);
check("and again steps into it", /^l:soccer\//.test(into ?? ""), into);
await page.keyboard.press("ArrowLeft");
const out = await page.evaluate(() => document.activeElement?.dataset.id);
check("Left steps back out to the folder", out === "s:soccer", out);
await page.keyboard.press("ArrowLeft");
check("and closes it", (await page.locator('li[data-id="s:soccer"]').getAttribute("aria-expanded")) === "false");
await page.locator('li[data-id="l:basketball/nba"]').focus();
const dotted = await page.evaluate(() => {
  const lb = document.querySelector('li[data-id="l:basketball/nba"] .cl-tv__lb');
  return getComputedStyle(lb).outlineStyle;
});
await page.keyboard.press("Enter");
await boardHas(NBA_ONLY);
const nbaNames = await page.locator(".cl-game__name").allTextContents();
check("Enter on a league picks it: only the Heat and Knicks show", nbaNames.join() === "Heat,Knicks", nbaNames.join());
check("the row the keyboard is on has a dotted rectangle", dotted === "dotted", dotted);
await page.keyboard.press("Enter");
await boardHas(ALL);
check("and Enter again lifts it", (await games()) === before);

// ---------------------------------------------------------------- opening
await page.locator('.cl-game[data-game$="-n1"]').click();
await page.waitForSelector(".sportstheater", { timeout: 10_000 }).catch(() => {});
check("clicking a game opens the theater, as its card does", (await page.locator(".sportstheater").count()) === 1);
await page.locator('.theater-overlay [aria-label="Back"]').first().click().catch(() => {});
await page.keyboard.press("Escape");
await page.waitForSelector(".cl-game", { timeout: 10_000 });

// ---------------------------------------------------------------- Default back
await setPack(false);
await page.waitForSelector(".upcard", { timeout: 10_000 });
check(
  "Default back: cards, section headings and the picker; no panel, group box or tree",
  (await page.locator(".cl-game, .cl-sports__day, .cl-tv, .cl-sports").count()) === 0 &&
    (await page.locator(".upcard, .compactcard").count()) > 0 &&
    (await page.locator(".leaguepick").count()) === 1 &&
    (await page.locator("section.media-row .sports__title").count()) > 0,
);

await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
