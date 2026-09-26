// E2E: multi-view's Live Scores row (v0.10.6).
//
// Adam: "at the bottom in one scrollable row instead of on the side, with a
// filter modal to pick what sports are shown". What this proves, under the
// IPC stub the other multi-view harnesses use and with ESPN answered here:
// - the row is off until you ask, and off costs nothing (ESPN not asked);
// - S (or the bar's switch) shows it: every live game in the leagues you
//   follow, each league named once, whether or not a channel carries it;
// - the grid gives up the row's height, stays 16:9 and stays above it;
// - the wheel scrolls it sideways;
// - a game none of your channels carry does nothing; one they carry opens
//   the picker on its feeds, taking one adds it, and the row marks it;
// - the filter offers your sports with their leagues, applies at once, and
//   is remembered with the row across a reload.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvscores.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const W = 1600;
const H = 900;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const proxy = http.createServer((rq, rs) => {
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => clearInterval(t));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;

/** One live event in ESPN's scoreboard shape. */
const liveEvent = ({ id, home, away, hs, as, network, detail }) => {
  const status = {
    clock: 442,
    displayClock: "7:22",
    period: 3,
    type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: detail },
  };
  const team = (t) => ({ id: t.id, displayName: t.name, shortDisplayName: t.short, abbreviation: t.abbr, name: t.short });
  return {
    id,
    date: new Date(Date.now() - 90 * 60_000).toISOString(),
    name: `${away.name} at ${home.name}`,
    shortName: `${away.abbr} @ ${home.abbr}`,
    status,
    competitions: [
      {
        id,
        date: new Date(Date.now() - 90 * 60_000).toISOString(),
        competitors: [
          { id: home.id, homeAway: "home", team: team(home), score: String(hs) },
          { id: away.id, homeAway: "away", team: team(away), score: String(as) },
        ],
        status,
        broadcasts: [{ market: "national", names: [network] }],
      },
    ],
  };
};

const NFL = liveEvent({
  id: "401",
  home: { id: "12", name: "Kansas City Chiefs", short: "Chiefs", abbr: "KC" },
  away: { id: "2", name: "Buffalo Bills", short: "Bills", abbr: "BUF" },
  hs: 24,
  as: 17,
  network: "ESPN",
  detail: "7:22 - 3rd",
});
const EPL = liveEvent({
  id: "702",
  home: { id: "359", name: "Arsenal", short: "Arsenal", abbr: "ARS" },
  away: { id: "363", name: "Chelsea", short: "Chelsea", abbr: "CHE" },
  hs: 1,
  as: 1,
  network: "Fake Sky Sports",
  detail: "63'",
});
// Six baseball games on a network none of the panel's channels is: scores
// with nothing to tune, and enough of them that the row runs off the edge.
const MLB = Array.from({ length: 6 }, (_, i) =>
  liveEvent({
    id: `90${i}`,
    home: { id: `h${i}`, name: `Home Club ${i}`, short: `Home ${i}`, abbr: `H${i}` },
    away: { id: `a${i}`, name: `Away Club ${i}`, short: `Away ${i}`, abbr: `A${i}` },
    hs: i,
    as: 2,
    network: "MLB Network",
    detail: "Bot 7th",
  }),
);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const asked = [];
const errors = [];
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.route(/strem\.io|a\.espncdn\.com/, (r) => r.abort());
await ctx.route(/site\.api\.espn\.com/, async (route) => {
  const path = new globalThis.URL(route.request().url()).pathname;
  asked.push(path);
  const events = path.includes("football/nfl")
    ? [NFL]
    : path.includes("soccer/eng.1")
      ? [EPL]
      : path.includes("baseball/mlb")
        ? MLB
        : [];
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events }) });
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(
  ({ port }) => {
    MediaSource.isTypeSupported = () => true;
    let cb = 0;
    let n = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (f) => {
        const id = ++cb;
        window["_" + id] = f;
        return id;
      },
      convertFileSrc: (p) => p,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      invoke: (cmd, args) => {
        if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
        if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
        if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
        return Promise.resolve(undefined);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    // Set once: the reload below must find what the page itself saved.
    if (sessionStorage.getItem("mvscores-seeded")) return;
    sessionStorage.setItem("mvscores-seeded", "1");
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
    // Four leagues in three sports: American football has two, so the
    // filter has a sport with leagues under it.
    localStorage.setItem(
      "blammytv.sports-follows",
      JSON.stringify({
        v: 1,
        data: {
          leagues: ["football/nfl", "football/college-football", "soccer/eng.1", "baseball/mlb"],
          teams: [],
          conferences: [],
        },
      }),
    );
    localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
    localStorage.setItem(
      "blammytv.playlists",
      JSON.stringify({
        v: 1,
        data: [
          {
            kind: "xtream",
            id: "t",
            name: "Test",
            enabled: true,
            server: "http://localhost:8081",
            username: "u",
            password: "p",
          },
        ],
      }),
    );
  },
  { port: PORT },
);

const rect = (sel) =>
  page.locator(sel).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    }),
  );
const switchOf = () => page.locator('.mvbar button[aria-label="Live scores"]');
const rowCards = () =>
  page.locator(".mvscores__row").evaluate((row) =>
    [...row.children].map((c) =>
      c.classList.contains("mvscores__league")
        ? { league: c.textContent }
        : {
            game: c.querySelector(".compactcard")?.getAttribute("title") ?? "",
            on: c.classList.contains("is-on"),
            off: c.classList.contains("is-off"),
          },
    ),
  );
const pickerSec = () => page.locator(".mvpick__sec").allInnerTexts().then((s) => s.join(" / "));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await goTo(page, "multiview");
await page.locator(".mvtab").waitFor();
await page.waitForTimeout(2000);
check(
  "off until you ask: no row, the switch says so, and nothing asks ESPN",
  (await page.locator(".mvscores").count()) === 0 &&
    (await switchOf().getAttribute("aria-pressed")) === "false" &&
    asked.length === 0,
  `${asked.length} asked`,
);

// A plain channel first, so there is a picture to measure with the row off.
await page.keyboard.press("a");
await page.locator(".mvpick__input").fill("News");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 });
await page.waitForTimeout(600);
const [offTile] = await rect(".mvtile:not(.mvtile--empty)");
const [offStage] = await rect(".mvtab__stage");

await page.mouse.move(W / 2, H / 2);
await page.keyboard.press("s");
await page.locator(".mvscores").waitFor();
await page
  .waitForFunction(() => document.querySelectorAll(".mvscores__game").length >= 8, null, { timeout: 15_000 })
  .catch(() => {});
const cards = await rowCards();
const labels = cards.filter((c) => c.league).map((c) => c.league);
// Each league's label comes straight before its games, and only once.
const grouped = labels.every((l) => {
  const at = cards.findIndex((c) => c.league === l);
  const next = cards.slice(at + 1).findIndex((c) => c.league);
  const run = cards.slice(at + 1, next === -1 ? undefined : at + 1 + next);
  return run.length > 0 && run.every((c) => c.game);
});
check(
  "S shows the row: every live game you follow, each league named once before its games",
  (await switchOf().getAttribute("aria-pressed")) === "true" &&
    cards.filter((c) => c.game).length === 8 &&
    JSON.stringify([...labels].sort()) === JSON.stringify(["MLB", "NFL", "Premier League"]) &&
    grouped,
  JSON.stringify(labels),
);
await page.waitForTimeout(400);
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/mv-scores.png` });

const [onTile] = await rect(".mvtile:not(.mvtile--empty)");
const [onStage] = await rect(".mvtab__stage");
const [row] = await rect(".mvscores");
const boxes = [...(await rect(".mvtile")), ...(await rect(".mvcap"))];
check(
  "the grid gives up the row's height: the picture shrinks, stays 16:9, and everything sits above the row",
  onStage.h < offStage.h &&
    onTile.h < offTile.h &&
    Math.abs((onTile.w * 9) / 16 - onTile.h) <= 1 &&
    boxes.length > 0 &&
    boxes.every((b) => b.bottom <= row.y),
  JSON.stringify({ off: [offTile.w, offTile.h], on: [onTile.w, onTile.h], rowTop: row.y, lowest: Math.max(...boxes.map((b) => b.bottom)) }),
);

const scroller = page.locator(".mvscores__row");
const room = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
const rowBox = await scroller.boundingBox();
await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(300);
const scrolled = await scroller.evaluate((el) => el.scrollLeft);
check("the wheel scrolls the row sideways", room.sw > room.cw && scrolled > 0, JSON.stringify({ ...room, scrolled }));
await scroller.evaluate((el) => (el.scrollLeft = 0));

// A baseball game: none of the panel's channels carry it.
const mlb = page.locator(".mvscores__game.is-off").first();
const mlbTitle = await mlb.getAttribute("title").catch(() => "");
await mlb.scrollIntoViewIfNeeded();
const mlbBox = await mlb.boundingBox();
await page.mouse.click(mlbBox.x + mlbBox.width / 2, mlbBox.y + mlbBox.height / 2);
await page.waitForTimeout(400);
// And from the keyboard, which the pointer's pass-through does not cover.
await mlb.locator(".compactcard").focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check(
  "a game none of your channels carry is dimmed, says why, and a click or Enter opens nothing",
  (await page.locator(".mvscores__game.is-off").count()) === 6 &&
    mlbTitle === "None of your channels carry it" &&
    (await page.locator(".mvpick__input").count()) === 0,
  mlbTitle,
);

// The Bills: on the panel's ESPN.
await scroller.evaluate((el) => (el.scrollLeft = 0));
await page.locator('.mvscores .compactcard[title*="Chiefs"]').scrollIntoViewIfNeeded();
await page.locator('.mvscores .compactcard[title*="Chiefs"]').click();
await page.locator(".mvpick__input").waitFor({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(250);
const feedRows = (await page.locator(".mvpick__row").allInnerTexts()).map((r) => r.replace(/\n/g, " | "));
const feedSec = await pickerSec();
check(
  "a game your channels carry opens the picker on its feeds, and adds nothing yet",
  /bills at chiefs: pick a feed/i.test(feedSec) &&
    feedRows.length === 1 &&
    /Fake ESPN 4K/.test(feedRows[0]) &&
    (await page.locator(".mvtile:not(.mvtile--empty)").count()) === 1,
  JSON.stringify({ feedSec, feedRows }),
);

await page.locator(".mvpick__row", { hasText: "Fake ESPN 4K" }).click();
await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);
const tiles = await page
  .locator(".mvtile:not(.mvtile--empty)")
  .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(",")[0]));
const marks = await rowCards();
check(
  "taking the feed adds the game, and the row marks it on the grid (and nothing else)",
  tiles.includes("Bills at Chiefs") &&
    marks.filter((c) => c.on).length === 1 &&
    /Chiefs.*Bills/.test(marks.find((c) => c.on)?.game ?? ""),
  JSON.stringify({ tiles, on: marks.filter((c) => c.on) }),
);

await page.keyboard.press("a");
await page.locator(".mvpick__input").waitFor();
await page.waitForTimeout(250);
const addSec = await pickerSec();
const addRows = await page.locator(".mvpick__row").allInnerTexts();
check(
  "the next Add opens on the list, not on that game's feeds",
  !/pick a feed/i.test(addSec) && addRows.length > 1,
  addSec,
);
await page.keyboard.press("Escape");
await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

// ---- THE FILTER -----------------------------------------------------------
await page.locator(".mvscores__filter").click();
await page.locator(".mvfilter").waitFor();
const sports = await page.locator(".mvfilter__sport").evaluateAll((els) =>
  els.map((s) => ({
    sport: s.querySelector(".mvfilter__row--sport span")?.textContent,
    leagues: [...s.querySelectorAll(".mvfilter__row:not(.mvfilter__row--sport)")].map((r) => r.textContent),
    on: [...s.querySelectorAll('[role="switch"]')].map((t) => t.getAttribute("aria-checked")),
  })),
);
if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/mv-scores-filter.png` });
check(
  "the filter offers the sports you follow; a sport with two leagues has a switch for each",
  sports.length === 3 &&
    sports.some((s) => s.sport === "American Football" && JSON.stringify(s.leagues) === '["NCAAF","NFL"]') &&
    sports.some((s) => s.sport === "Baseball · MLB" && s.leagues.length === 0) &&
    sports.every((s) => s.on.every((o) => o === "true")),
  JSON.stringify(sports),
);

const sw = (label) => page.locator(`.mvfilter [role="switch"][aria-label="${label}"]`);
await sw("Baseball").click();
await page.waitForTimeout(250);
const noBaseball = await rowCards();
check(
  "a sport switched off leaves the row at once, and the filter button shows something is hidden",
  noBaseball.filter((c) => c.game).length === 2 &&
    !noBaseball.some((c) => c.league === "MLB") &&
    (await page.locator(".mvscores__filter.is-filtered").count()) === 1,
  JSON.stringify(noBaseball),
);

await sw("American Football").click();
await page.waitForTimeout(150);
const footballOff = await Promise.all(["NFL", "NCAAF"].map((l) => sw(l).getAttribute("aria-checked")));
await sw("NFL").click();
await page.waitForTimeout(150);
const nflBack = {
  sport: await sw("American Football").getAttribute("aria-checked"),
  nfl: await sw("NFL").getAttribute("aria-checked"),
  ncaaf: await sw("NCAAF").getAttribute("aria-checked"),
};
check(
  "a sport's switch covers its leagues; one league back on turns the sport back on",
  footballOff.every((v) => v === "false") && nflBack.sport === "true" && nflBack.nfl === "true" && nflBack.ncaaf === "false",
  JSON.stringify({ footballOff, nflBack }),
);
await page.keyboard.press("Escape");
await page.locator(".mvfilter").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

await page.reload({ waitUntil: "domcontentloaded" });
await goTo(page, "multiview");
await page.locator(".mvscores").waitFor({ timeout: 10_000 }).catch(() => {});
await page
  .waitForFunction(() => document.querySelectorAll(".mvscores__game").length >= 2, null, { timeout: 15_000 })
  .catch(() => {});
const after = await rowCards();
check(
  "after a reload the row is still on, and still leaves baseball out",
  (await switchOf().getAttribute("aria-pressed")) === "true" &&
    after.filter((c) => c.game).length === 2 &&
    !after.some((c) => c.league === "MLB"),
  JSON.stringify(after),
);

await page.locator(".mvscores__filter").click();
await page.locator(".mvfilter").waitFor();
await sw("American Football").click();
await sw("Fútbol").click();
await page.waitForTimeout(250);
const emptyText = await page.locator(".mvscores__empty").textContent().catch(() => "");
check("everything filtered out says so", emptyText === "No live games in the sports you picked.", emptyText);
await page.keyboard.press("Escape");
await page.locator(".mvfilter").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

// The stage, not a picture: two tiles side by side are bound by the width,
// so they keep their size either way.
await page.mouse.move(W / 2, H / 2);
await page.keyboard.press("s");
await page.waitForTimeout(600);
const [backStage] = await rect(".mvtab__stage");
check(
  "S again hides the row, and the grid takes the height back",
  (await page.locator(".mvscores").count()) === 0 &&
    (await switchOf().getAttribute("aria-pressed")) === "false" &&
    Math.abs(backStage.h - offStage.h) <= 1,
  JSON.stringify({ off: offStage.h, withRow: onStage.h, back: backStage.h }),
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
