// Headless verify: the Sports theater keeps the evidence the channel
// pairing is measured with (v0.9.122), and the probe hands it back.
//
// What this proves, through the `?sportstheater=1` seam and the IPC stub
// verify-sports-theater uses:
// - autoplay's pick is logged as such (the top of the rail, rank 0), and
//   its first frame as played;
// - a rail row's right-click menu marks it wrong for this game: the row
//   says so, the log has it, and the menu then says it is marked; Escape
//   closes the menu and nothing else;
// - a row clicked by hand is logged as a hand pick, with its place;
// - a feed that never plays is logged dead when the watchdog gives up, and
//   the next row down as a failover pick;
// - `btvPairing()` returns the board's rails as the theater builds them,
//   the log, and the catalog's shape, and carries no stream URL at all.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs   # :8082
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-sports-pairing.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/?sportstheater=1";
let fail = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

const PLAYLIST = {
  v: 1,
  data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }],
};
// Two of fake-m3u's channels carry it: "Fake Sky Sports FHD" by its exact
// name (100), "Fake ESPN 4K" by its trailing acronym (90). So the rail is
// Sky, then ESPN, and autoplay takes Sky.
const GAME = {
  kind: "fixture",
  id: "g1",
  sport: "football",
  league: "NFL",
  leagueKey: "football/nfl",
  state: "live",
  start: new Date().toISOString(),
  status: "3rd 07:22",
  broadcasts: ["Fake Sky Sports", "ESPN"],
  channels: [],
  home: { name: "Kansas City Chiefs", shortName: "Chiefs", abbr: "KC" },
  away: { name: "Buffalo Bills", shortName: "Bills", abbr: "BUF" },
};
const GAME_NAME = "Buffalo Bills at Kansas City Chiefs";
const SKY = "Fake Sky Sports FHD";
const ESPN = "Fake ESPN 4K";

/** The same game, as ESPN's scoreboard would send it, for the probe. */
const EVENT = {
  id: "g1",
  date: GAME.start,
  name: "Buffalo Bills at Kansas City Chiefs",
  shortName: "BUF @ KC",
  status: { type: { state: "in", completed: false, shortDetail: "7:22 - 3rd" }, displayClock: "7:22", period: 3 },
  competitions: [
    {
      id: "g1",
      date: GAME.start,
      competitors: [
        { id: "12", homeAway: "home", score: "17", team: { id: "12", displayName: "Kansas City Chiefs", shortDisplayName: "Chiefs", abbreviation: "KC" } },
        { id: "2", homeAway: "away", score: "20", team: { id: "2", displayName: "Buffalo Bills", shortDisplayName: "Bills", abbreviation: "BUF" } },
      ],
      status: { type: { state: "in", completed: false, shortDetail: "7:22 - 3rd" } },
      broadcasts: [{ market: "national", names: GAME.broadcasts }],
    },
  ],
};

const stub = (presenting) => `
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => { const id = ++cb; window["_" + id] = f; return id; },
    convertFileSrc: (p) => p,
    // The window plugin's, so the theater's own Escape can ask whether it
    // is in full screen and, answered no, leave: which is what makes the
    // Escape check below able to see a theater that heard the menu's key.
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: (cmd, args) => {
      if (cmd === "http_get") return fetch(args.url).then((r) => r.text());
      if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
      if (cmd === "mpv_status") {
        return Promise.resolve(JSON.stringify({
          pos: 82, dur: 24.745, presenting: ${presenting}, ended: false,
          buffering: false, seekable: true, cacheDur: 18, dvrStart: 0, dvrEnd: 100,
          audio: [], subs: [], chapters: [],
        }));
      }
      return Promise.resolve(undefined);
    },
  };
  window.__sportsFixture = { game: ${JSON.stringify(GAME)}, others: [] };
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", ${JSON.stringify(JSON.stringify(PLAYLIST))});
`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const log = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.sportsPairingLog") ?? "{}").data ?? []);
const row = (page, name) => page.locator(".sportsrail", { hasText: name });

// ---------------------------------------------------------- a feed that plays
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route(/a\.espncdn\.com|strem\.io/, (r) => r.abort());
  await ctx.route(/site\.api\.espn\.com/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: r.request().url().includes("football/nfl") ? [EVENT] : [] }),
    }),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(stub(true));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".theater-overlay", { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const first = await log(page);
  const auto = first.find((e) => e.kind === "tune");
  check(
    "autoplay's pick is logged: the top of the rail, for this game",
    !!auto && auto.how === "auto" && auto.rank === 0 && auto.channel === SKY && auto.confidence === 100 && auto.game === GAME_NAME,
    JSON.stringify(auto),
  );
  const played = first.find((e) => e.kind === "played");
  check(
    "and its first frame, as played",
    !!played && played.channel === SKY && Number.isFinite(played.ms) && played.ms >= 0,
    JSON.stringify(played),
  );

  await row(page, ESPN).click({ button: "right" });
  const menu = page.locator("[data-slot='context-menu-content']");
  const text = await menu.innerText({ timeout: 3000 }).catch(() => "");
  await page.getByRole("menuitem", { name: "Wrong channel for this game" }).click();
  await page.waitForTimeout(300);
  const tag = await row(page, ESPN).locator(".sportsrail__wrong").count();
  const wrong = (await log(page)).find((e) => e.kind === "wrong");
  check(
    "a rail row's right-click marks it wrong for this game: the row says so, and the log has it",
    text.includes(ESPN) && tag === 1 && wrong?.channel === ESPN && wrong.confidence === 90 && wrong.rank === 1,
    JSON.stringify({ text, tag, wrong }),
  );
  await row(page, ESPN).click({ button: "right" });
  const again = await page.getByRole("menuitem", { name: "Marked wrong for this game" }).getAttribute("data-disabled").catch(() => null);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("and the menu then says it is marked, and offers nothing more", again !== null, String(again));
  // The menu takes the Escape that dismisses it: the theater and its
  // player's own Escape (leave, collapse) used to hear it too.
  check(
    "Escape closes the menu and leaves the theater where it is",
    (await page.locator("[data-slot='context-menu-content']").count()) === 0 &&
      (await page.locator(".sportstheater").count()) === 1,
  );

  await row(page, ESPN).click();
  await page.waitForTimeout(1500);
  const hand = (await log(page)).filter((e) => e.kind === "tune").at(-1);
  check("a row clicked by hand is logged as one, with its place", hand?.how === "hand" && hand.rank === 1 && hand.channel === ESPN, JSON.stringify(hand));

  const report = await page.evaluate(() => window.btvPairing("football/nfl"));
  const g = report?.games?.[0];
  const flat = JSON.stringify(report ?? {});
  check(
    "btvPairing returns the rail as the theater builds it, and what autoplay and the card make of it",
    !!g && g.rail[0][0] === SKY && g.rail[0][1] === 100 && g.rail[1][0] === ESPN && g.card === 2,
    JSON.stringify(g),
  );
  check(
    "and the log, and the catalog's shape",
    report.log.length === (await log(page)).length &&
      report.catalog.channels > 0 &&
      Array.isArray(report.catalog.prefixes) &&
      "FOX" in report.affiliates,
    JSON.stringify({ log: report.log.length, catalog: report.catalog.channels }),
  );
  check("and no stream URL anywhere in it", !/https?:\/\/|localhost:8082/.test(flat), flat.match(/https?:\/\/\S{0,40}/)?.[0] ?? "");
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------ a feed that never plays
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route(/a\.espncdn\.com|strem\.io|site\.api\.espn\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  await page.addInitScript(stub(false));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60 && !(await page.locator(".theater-overlay").count()); i++) await page.clock.runFor(500);
  // Two silent reloads, 10s apart, then dead, and the rail steps down.
  for (let i = 0; i < 40; i++) await page.clock.runFor(1000);
  const events = await log(page);
  const dead = events.find((e) => e.kind === "dead");
  const next = events.filter((e) => e.kind === "tune").at(-1);
  check(
    "a feed that never plays is logged dead when the watchdog gives up, and the next row as a failover pick",
    dead?.channel === SKY && next?.how === "failover" && next.channel === ESPN && next.rank === 1,
    JSON.stringify(events.map((e) => [e.kind, e.channel, e.how ?? ""])),
  );
  check("and nothing was logged as played", !events.some((e) => e.kind === "played"));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
process.exit(fail ? 1 : 0);
