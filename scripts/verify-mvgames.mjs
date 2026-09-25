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
  // The fake panel's own name for it. A bare "Sky Sports" scores 40 against
  // "Fake Sky Sports FHD" (the extra "Fake" makes it loose), under the 70 a
  // game needs to claim a channel, so the game would rightly have none.
  network: "Fake Sky Sports",
  detail: "63'",
});

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const asked = [];
const errors = [];
/** A page on the multi-view tab's doorstep, ESPN answered from here. */
const open = async ({ follows }) => {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/strem\.io|a\.espncdn\.com/, (r) => r.abort());
  await ctx.route(/site\.api\.espn\.com/, async (route) => {
    const path = new globalThis.URL(route.request().url()).pathname;
    asked.push(path);
    const events = path.includes("football/nfl") ? [NFL] : path.includes("soccer/eng.1") ? [EPL] : [];
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
await page.locator('[data-dest="multiview"]').click({ timeout: 30_000 });
await page.locator(".mvtab").waitFor();
await page.waitForTimeout(2000);
check("with the picker shut and no game on the grid, nothing asks ESPN", asked.length === 0, `${asked.length} asked`);

await page.keyboard.press("a");
await page.locator(".mvpick__input").waitFor();
await page.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 0, null, { timeout: 15_000 }).catch(() => {});
const leagues = [...new Set(asked.map((p) => p.split("/sports/")[1]?.split("/scoreboard")[0]))].sort();
const rows = await page.locator(".mvpick__row").allInnerTexts();
check(
  "opening the picker asks the leagues you follow, and lists their live games on your channels",
  JSON.stringify(leagues) === JSON.stringify(["football/nfl", "soccer/eng.1"]) &&
    rows.some((r) => r.includes("Fake ESPN 4K")) &&
    rows.some((r) => r.includes("Fake Sky Sports FHD")),
  JSON.stringify({ leagues, rows: rows.map((r) => r.replace(/\n/g, " | ")) }),
);
check(
  "Fill with live games is the first row, and says what it adds",
  /^Fill with live games[\s\S]*Adds 2 games, the ones you follow first/.test(rows[0] ?? ""),
  (rows[0] ?? "").replace(/\n/g, " | "),
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
await page.locator('[data-dest="multiview"]').click({ timeout: 30_000 });
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
await bare.locator('[data-dest="multiview"]').click({ timeout: 30_000 });
await bare.locator(".mvtab").waitFor();
await bare.keyboard.press("a");
await bare.waitForFunction(() => document.querySelectorAll(".mvpick__game").length > 1, null, { timeout: 15_000 }).catch(() => {});
const bareFill = (await bare.locator(".mvpick__row").first().innerText().catch(() => "")).replace(/\n/g, " | ");
check(
  "following nothing, Fill offers both games and does not say it put yours first",
  /^Fill with live games \| Adds 2 games$/.test(bareFill),
  bareFill,
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
