// E2E: live games in multi-view (plan 017, P3b).
//
// P3a's picker offered the games the Sports board last saw, up to half an
// hour old, and a game tile had no score. Multi-view now asks ESPN itself,
// only while something needs it. What this proves, under the IPC stub the
// other multi-view harnesses use and with ESPN answered by this script:
// - the tab asks ESPN nothing until the picker opens or a tile is a game;
// - then it asks the leagues you follow, and the picker lists their live
//   games on your channels;
// - "Fill with live games" is the first row, adds as many as the line has
//   room for, and puts the game you follow first;
// - a game tile carries its score and clock, in the caption and under the
//   pointer;
// - after a reload the game tiles are back with their scores, asked for
//   without opening the picker.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvgames.mjs
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
const liveEvent = ({ id, home, away, hs, as, network, networks, detail }) => {
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
        broadcasts: [{ market: "national", names: networks ?? [network] }],
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
  // The fake panel's own name for it. A bare "Sky Sports" scores 40 against
  // "Fake Sky Sports FHD" (the extra "Fake" makes it loose), under the 70 a
  // game needs to claim a channel, so the game would rightly have none.
  network: "Fake Sky Sports",
  detail: "63'",
});

// The same game on two networks, so it has two feeds (v0.10.3).
const NFL_TWO = liveEvent({
  id: "401",
  home: { id: "12", name: "Kansas City Chiefs", short: "Chiefs", abbr: "KC" },
  away: { id: "2", name: "Buffalo Bills", short: "Bills", abbr: "BUF" },
  hs: 24,
  as: 17,
  networks: ["ESPN", "Fake Sky Sports"],
  detail: "7:22 - 3rd",
});

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const asked = [];
const errors = [];
/** A page on the multi-view tab's doorstep, ESPN answered from here. */
const open = async ({ follows, nfl = NFL }) => {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/strem\.io|a\.espncdn\.com/, (r) => r.abort());
  await ctx.route(/site\.api\.espn\.com/, async (route) => {
    const path = new globalThis.URL(route.request().url()).pathname;
    asked.push(path);
    const events = path.includes("football/nfl") ? [nfl] : path.includes("soccer/eng.1") ? [EPL] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(stub, { port: PORT, follows });
  return page;
};
const stub = ({ port, follows }) => {
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
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
  // Two leagues followed, and Chelsea: the football game is on first in
  // the list, the one you follow should still fill first.
  if (follows)
    localStorage.setItem(
      "blammytv.sports-follows",
      JSON.stringify({ v: 1, data: { leagues: ["football/nfl", "soccer/eng.1"], teams: ["soccer/eng.1:363"], conferences: [] } }),
    );
  // Start on Stream, so nothing on the way (the Sports board) asks ESPN.
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
};
const page = await open({ follows: true });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await goTo(page, "multiview");
await page.locator(".mvtab").waitFor();
await page.waitForTimeout(2000);
check("with the picker shut and no game on the grid, nothing asks ESPN", asked.length === 0, `${asked.length} asked`);

await page.keyboard.press("a");
await page.locator(".mvpick__input").waitFor();
await page.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 0, null, { timeout: 15_000 }).catch(() => {});
const leagues = [...new Set(asked.map((p) => p.split("/sports/")[1]?.split("/scoreboard")[0]))].sort();
const rows = await page.locator(".mvpick__row").allInnerTexts();
// A game row names the game and how many feeds it has; which one is asked
// for when it is taken (v0.10.3).
check(
  "opening the picker asks the leagues you follow, and lists their live games on your channels",
  JSON.stringify(leagues) === JSON.stringify(["football/nfl", "soccer/eng.1"]) &&
    rows.some((r) => r.includes("Bills") && r.includes("1 feed")) &&
    rows.some((r) => r.includes("Chelsea") && r.includes("1 feed")),
  JSON.stringify({ leagues, rows: rows.map((r) => r.replace(/\n/g, " | ")) }),
);
check(
  "Fill with live games is the first row, and says what it adds",
  /^Fill with live games[\s\S]*Adds 2 games, the ones you follow first/.test(rows[0] ?? ""),
  (rows[0] ?? "").replace(/\n/g, " | "),
);
// In the palette's look (v0.10.26), a game keeps the Sports matchup (Adam:
// "without losing the cool live games thing"): both teams' abbreviations
// over their names in the headline face, at 15px, the row taller than a
// channel's 32.
const game = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".mvpick__row")].find((r) => r.querySelector(".matchup"));
  if (!row) return null;
  const name = row.querySelector(".matchup__name");
  return {
    abbrs: [...row.querySelectorAll(".matchup__abbr")].map((a) => a.textContent),
    size: parseFloat(getComputedStyle(name).fontSize),
    weight: getComputedStyle(name).fontWeight,
    h: Math.round(row.getBoundingClientRect().height),
  };
});
check(
  "a game row keeps the matchup: both abbreviations over bold 15px names",
  !!game && game.abbrs.length === 2 && game.size === 15 && game.weight === "700" && game.h > 32,
  JSON.stringify(game),
);

await page.keyboard.press("Enter");
await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 });
await page.waitForTimeout(500);
const tiles = await page
  .locator(".mvtile:not(.mvtile--empty)")
  .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(",")[0]));
check(
  "Fill adds them both, the game you follow first",
  JSON.stringify(tiles) === JSON.stringify(["Chelsea at Arsenal", "Bills at Chiefs"]),
  JSON.stringify(tiles),
);

const caps = await page.locator(".mvcap").allInnerTexts();
check(
  "each game's caption carries its score and clock",
  caps.some((c) => c.includes("CHE 1 – 1 ARS")) && caps.some((c) => c.includes("BUF 17 – 24 KC · 7:22 - 3rd")),
  JSON.stringify(caps),
);
await page.evaluate(() =>
  document.querySelectorAll("video.mvtile__video").forEach((v) => v.dispatchEvent(new Event("playing"))),
);
const nfl = page.locator('.mvtile[aria-label^="Bills at Chiefs,"]');
await nfl.hover();
await page.waitForTimeout(400);
const title = await nfl.locator(".mvtile__title").textContent().catch(() => "");
const status = await nfl.locator(".mvtile__gamestatus").textContent().catch(() => "");
check(
  "under the pointer, the score and the clock in place of the guide",
  title === "BUF 17 – 24 KC" && status === "7:22 - 3rd · NFL",
  `${title} / ${status}`,
);

// A reload: the game tiles come back, and their scores are asked for with
// the picker shut, because a tile is a game.
asked.length = 0;
await page.reload({ waitUntil: "domcontentloaded" });
await goTo(page, "multiview");
await page.waitForFunction(() => /–/.test(document.querySelector(".mvcap")?.textContent ?? ""), null, {
  timeout: 15_000,
}).catch(() => {});
const capsAfter = await page.locator(".mvcap").allInnerTexts();
check(
  "after a reload the game tiles are back with their scores, without the picker",
  capsAfter.some((c) => c.includes("BUF 17 – 24 KC")) &&
    asked.length > 0 &&
    (await page.locator(".mvpick__input").count()) === 0,
  JSON.stringify({ capsAfter, asked: asked.length }),
);

// Following nothing: Fill still fills, from the whole catalog, and does not
// claim an order it did not use.
const bare = await open({ follows: false });
await bare.goto(URL, { waitUntil: "domcontentloaded" });
await goTo(bare, "multiview");
await bare.locator(".mvtab").waitFor();
await bare.keyboard.press("a");
await bare.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 1, null, { timeout: 15_000 }).catch(() => {});
const bareFill = (await bare.locator(".mvpick__row").first().innerText().catch(() => "")).replace(/\n/g, " | ");
check(
  "following nothing, Fill offers both games and does not say it put yours first",
  /^Fill with live games \| Adds 2 games$/.test(bareFill),
  bareFill,
);

// With the picker shut only the grid's games matter, so only their leagues
// are asked (plan 018, P5). Following nothing is the case that shows it: a
// full look asks the whole catalog, and the grid holds two leagues.
await bare.keyboard.press("Enter");
await bare.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
asked.length = 0;
await bare.reload({ waitUntil: "domcontentloaded" });
await goTo(bare, "multiview");
await bare.waitForFunction(() => /–/.test(document.querySelector(".mvcap")?.textContent ?? ""), null, {
  timeout: 15_000,
}).catch(() => {});
await bare.waitForTimeout(1000);
const leagueOf = (p) => p.split("/sports/")[1]?.split("/scoreboard")[0];
const shut = [...new Set(asked.map(leagueOf))].sort();
asked.length = 0;
await bare.keyboard.press("a");
await bare.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 1, null, { timeout: 15_000 }).catch(() => {});
const opened = new Set(asked.map(leagueOf)).size;
check(
  "with the picker shut, the score poll asks only the grid's leagues; opened, it asks them all",
  JSON.stringify(shut) === JSON.stringify(["football/nfl", "soccer/eng.1"]) && opened > 10,
  JSON.stringify({ shut, opened }),
);

// ---- A GAME ASKS WHICH FEED (v0.10.3) ----------------------------------
// Adam: "sometimes it chooses the wrong source for the game and theres no
// way to override it". Taking a game opens its feeds, best match first.
{
  const two = await open({ follows: true, nfl: NFL_TWO });
  await two.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(two, "multiview");
  await two.locator(".mvtab").waitFor();
  await two.keyboard.press("a");
  await two.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 1, null, { timeout: 15_000 }).catch(() => {});
  const gameRow = two.locator(".mvpick__row", { hasText: "Bills" });
  check("a game on two networks says it has 2 feeds", (await gameRow.innerText().catch(() => "")).includes("2 feeds"));

  const feeds = async () => ({
    sec: (await two.locator(".mvpick__sec").allInnerTexts()).join(" / "),
    rows: (await two.locator(".mvpick__row").allInnerTexts()).map((r) => r.replace(/\n/g, " | ")),
    input: await two.locator(".mvpick__input").getAttribute("placeholder").catch(() => ""),
  });
  await gameRow.click();
  await two.waitForTimeout(250);
  const f = await feeds();
  if (process.env.SHOT_DIR) await two.screenshot({ path: `${process.env.SHOT_DIR}/mv-feeds.png` });
  check(
    "taking the game opens its feeds, the best match first and marked, and adds nothing yet",
    /bills at chiefs: pick a feed/i.test(f.sec) &&
      f.rows.length === 2 &&
      /Fake ESPN 4K.*Best match/.test(f.rows[0]) &&
      /Fake Sky Sports FHD/.test(f.rows[1]) &&
      !/Best match/.test(f.rows[1]) &&
      f.input === "Search this game's feeds" &&
      (await two.locator(".mvtile:not(.mvtile--empty)").count()) === 0,
    JSON.stringify(f),
  );

  await two.keyboard.press("Escape");
  await two.waitForTimeout(250);
  const esc = await feeds();
  check(
    "Escape goes back to the list, and the picker stays open",
    (await two.locator(".mvpick__input").count()) === 1 && esc.rows.some((r) => /Bills.*2 feeds/.test(r)),
    JSON.stringify(esc),
  );
  await gameRow.click();
  await two.waitForTimeout(250);
  await two.locator(".mvpick__input").press("Backspace");
  await two.waitForTimeout(250);
  const bs = await feeds();
  check("so does Backspace in the empty search", bs.rows.some((r) => /Bills.*2 feeds/.test(r)), JSON.stringify(bs));

  // The second feed, which the old picker could never take.
  await gameRow.click();
  await two.waitForTimeout(250);
  await two.locator(".mvpick__row", { hasText: "Fake Sky Sports FHD" }).click();
  await two.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await two.waitForTimeout(400);
  const added = await two
    .locator(".mvtile:not(.mvtile--empty)")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(",")[0]));
  await two.keyboard.press("a");
  await two.locator(".mvpick__input").waitFor();
  await two.locator(".mvpick__input").fill("Fake");
  await two.waitForTimeout(300);
  const which = (await two.locator(".mvpick__row").allInnerTexts()).map((r) => r.replace(/\n/g, " | "));
  check(
    "the feed you pick is the one the game's tile plays",
    JSON.stringify(added) === JSON.stringify(["Bills at Chiefs"]) &&
      which.some((r) => /Fake Sky Sports FHD.*In the grid/.test(r)) &&
      which.some((r) => /Fake ESPN 4K/.test(r) && !/In the grid/.test(r)),
    JSON.stringify({ added, which }),
  );
  await two.locator(".mvpick__input").fill("");
  await two.waitForTimeout(300);
  const epl = await two.locator(".mvpick__row", { hasText: "Chelsea" }).innerText().catch(() => "");
  const nflRow = await two.locator(".mvpick__row", { hasText: "Bills" }).innerText().catch(() => "");
  check(
    "a game is taken only once all its feeds are: Arsenal's one is, the Bills' other is free",
    /In the grid/.test(epl) && !/In the grid/.test(nflRow),
    JSON.stringify({ epl, nflRow }),
  );
  await two.keyboard.press("Escape");
  await two.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  // A wrong feed, fixed after it plays: R on the tile, the game, its other
  // feed. The one playing sorts last and cannot be taken again.
  await two.locator(".mvtile:not(.mvtile--empty)").first().focus();
  await two.keyboard.press("r");
  await two.locator(".mvpick__input").waitFor();
  await two.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 0, null, { timeout: 15_000 }).catch(() => {});
  await two.locator(".mvpick__row", { hasText: "Bills" }).click();
  await two.waitForTimeout(250);
  const swap = await feeds();
  await two.keyboard.press("Enter");
  await two.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await two.waitForTimeout(400);
  await two.keyboard.press("a");
  await two.locator(".mvpick__input").waitFor();
  await two.locator(".mvpick__input").fill("Fake");
  await two.waitForTimeout(300);
  const after = (await two.locator(".mvpick__row").allInnerTexts()).map((r) => r.replace(/\n/g, " | "));
  check(
    "R on a game's tile swaps it to another feed: the free one first, Enter takes it",
    /Fake ESPN 4K/.test(swap.rows[0] ?? "") &&
      /Fake Sky Sports FHD.*In the grid/.test(swap.rows[1] ?? "") &&
      after.some((r) => /Fake ESPN 4K.*In the grid/.test(r)) &&
      after.some((r) => /Fake Sky Sports FHD/.test(r) && !/In the grid/.test(r)),
    JSON.stringify({ swap: swap.rows, after }),
  );
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
