// E2E: multi-view's count of the line, and the grid it remembers (plan 018, H2).
//
// What this proves, under the IPC stub the other multi-view harnesses use:
// - a panel poll that fails keeps the last count: a full line stays full,
//   where a failed poll used to lift the limit until the next good one;
// - a playlist that fails to load keeps its tiles, where they used to be
//   dropped and the smaller grid saved;
// - a channel picked after the line filled while the picker was open asks
//   which tile it replaces, where it used to add nothing and say nothing;
// - a game tile goes back to being its channel once the game is long over;
// - a score kept through failed looks at ESPN says when it is from.
// The rules themselves are unit tested (mvGrid.test.ts, connections.test.ts);
// this is them wired into the tab.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvline.mjs
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

/** ESPN out of reach, from the moment a test says so. */
let espnDown = false;

/** How each channel's stream behaves, by stream id; changed as tests go. */
const modes = new Map();
/** The responses open now, by stream id. */
const open = new Map();
const proxy = http.createServer((rq, rs) => {
  const id = rq.url.split("/")[2]?.split("-")[0];
  const mode = modes.get(id) ?? "live";
  if (mode === "403") {
    rs.writeHead(403, { "Access-Control-Allow-Origin": "*" });
    return rs.end();
  }
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  const set = open.get(id) ?? new Set();
  set.add(rs);
  open.set(id, set);
  rs.on("close", () => {
    clearInterval(t);
    set.delete(rs);
  });
  // Every connection dies young: the stream that keeps dying.
  if (mode === "dies") setTimeout(() => rs.destroy(), 300);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;
/** Cut a channel's stream (the connection torn down), or end it cleanly. */
const drop = (id, how = "cut") => {
  for (const rs of open.get(id) ?? []) how === "cut" ? rs.destroy() : rs.end();
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ESPN = "Fake ESPN 4K";
const SKY = "Fake Sky Sports FHD";
const NEWS = "Fake News Channel";
const pickOf = (id, label) => ({ channelId: `t:${id}`, label });

/** The tab, with this grid remembered and this line on the panel. */
async function openTab({ grid, sound, line = [0, 3], frames = false, espn = null, clock = false, catalogDown = false, m3u = false, lax = false }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/a\.espncdn\.com|strem\.io/, (r) => r.abort());
  // ESPN answers what the test says until the test takes it down.
  espnDown = false;
  await ctx.route(/site\.api\.espn\.com/, async (route) => {
    const path = new globalThis.URL(route.request().url()).pathname;
    if (espnDown) return route.abort();
    // Every league answers, most with nothing on: a board of aborts is an
    // outage, not a quiet day.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: espn ? espn(path) : [] }) });
  });
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid, sound, line, frames, catalogDown, m3u }) => {
      MediaSource.isTypeSupported = () => true;
      window.__catalogDown = catalogDown;
      window.__opens = [];
      window.__closes = [];
      window.__polls = 0;
      window.__line = line;
      if (frames) {
        // Decoded frames, as the test says, on a tile that is not paused.
        window.__frames = 0;
        HTMLVideoElement.prototype.getVideoPlaybackQuality = function () {
          return { totalVideoFrames: window.__frames, droppedVideoFrames: 0 };
        };
        Object.defineProperty(HTMLMediaElement.prototype, "paused", { get: () => false, configurable: true });
      }
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
          if (cmd === "http_get") {
            // The panel's count is the test's: every other answer is the
            // fake panel's own.
            // The catalog, down: the playlist fails to load.
            if (window.__catalogDown && /action=get_live_streams/.test(args.url))
              return Promise.reject(new Error("panel timed out"));
            if (/player_api\.php/.test(args.url) && !/action=/.test(args.url)) {
              window.__polls++;
              if (window.__pollFails) return Promise.reject(new Error("panel timed out"));
              return fetch(args.url)
                .then((r) => r.json())
                .then((j) => {
                  j.user_info.active_cons = String(window.__line[0]);
                  j.user_info.max_connections = String(window.__line[1]);
                  return new TextEncoder().encode(JSON.stringify(j)).buffer;
                });
            }
            return fetch(args.url).then((r) => r.arrayBuffer());
          }
          if (cmd === "mv_proxy_open") {
            const id = args.url.match(/(\d+)\.ts$/)?.[1];
            const local = `http://127.0.0.1:${port}/mv/${id}-${++n}`;
            window.__opens.push([id, local]);
            return Promise.resolve(local);
          }
          if (cmd === "mv_proxy_close") window.__closes.push(args.local);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      localStorage.setItem("blammytv.multiviewGrid", JSON.stringify({ v: 1, data: { picks: grid, sound } }));
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
            // A second playlist that loads, when asked for: with the only
            // one down the catalog is empty, and nothing is judged at all.
            ...(m3u
              ? [{ kind: "m3u", id: "m", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }]
              : []),
          ],
        }),
      );
    },
    { port: PORT, grid, sound, line, frames, catalogDown, m3u },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  // lax: the section judges the tiles itself, so losing them is a FAIL
  // there rather than a crash here.
  await page
    .waitForFunction((k) => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === k, grid.length, {
      timeout: 15_000,
    })
    .catch((e) => {
      if (!lax) throw e;
    });
  return { page, ctx, errors };
}

const opensOf = (page, id) => page.evaluate((i) => window.__opens.filter(([x]) => x === i).length, id);
/** The tile's first frame, as far as the page can tell. */
const playing = (page, name) =>
  page.evaluate(
    (n) => document.querySelector(`.mvtile[aria-label^="${CSS.escape(n)},"] video`)?.dispatchEvent(new Event("playing")),
    name,
  );
/** Wait for a tile's stream to have been opened `k` times. */
const opened = (page, id, k, timeout = 10_000) =>
  page
    .waitForFunction(([i, c]) => window.__opens.filter(([x]) => x === i).length >= c, [id, k], { timeout })
    .then(() => true, () => false);
/** Wait until the stream is actually being served (the proxy has it). */
const served = async (id) => {
  for (let i = 0; i < 50 && !(open.get(id)?.size > 0); i++) await sleep(100);
  return open.get(id)?.size > 0;
};


const savedGrid = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.multiviewGrid") ?? "null")?.data?.picks ?? []);

// ------------------------------------------- a failed poll keeps the count
{
  modes.set("101", "live");
  const { page, ctx, errors } = await openTab({ grid: [pickOf(101, ESPN)], sound: "t:101", line: [3, 3] });
  await opened(page, "101", 1);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(1500);
  // The stream drops on a full line: the reconnect waits for a slot, and
  // every poll from here fails. The line stays as last read: full.
  await page.evaluate(() => (window.__pollFails = true));
  drop("101", "cut");
  await page.waitForTimeout(9000);
  const polls = await page.evaluate(() => window.__polls);
  const held = await opensOf(page, "101");
  await page.evaluate(() => {
    window.__pollFails = false;
    window.__line = [2, 3];
  });
  const went = await opened(page, "101", 2, 12_000);
  check(
    "a poll that fails keeps the last count: a full line stays full, and the reconnect waits",
    held === 1 && polls >= 2 && went,
    JSON.stringify({ opensWhileFailing: held, polls, wentAfter: went }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// --------------------------------- a playlist that fails keeps its tiles
{
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN), pickOf(102, SKY)],
    sound: "t:101",
    catalogDown: true,
    m3u: true,
    lax: true,
  });
  await page.waitForTimeout(4000);
  const kept = (await savedGrid(page)).map((p) => p.channelId);
  const tiles = await page.locator(".mvtile:not(.mvtile--empty)").count();
  // The M3U loaded, so there is a catalog to judge the grid by. Without it
  // nothing gets judged and the check above would pass on an empty page.
  await page.keyboard.press("a");
  await page.locator(".mvpick__input").waitFor({ timeout: 5000 }).catch(() => {});
  await page.locator(".mvpick__input").fill("weather").catch(() => {});
  const catalogUp = await page
    .locator(".mvpick__row", { hasText: "Fake Weather Now" })
    .first()
    .waitFor({ timeout: 5000 })
    .then(() => true, () => false);
  check(
    "a playlist that fails to load keeps its tiles, and the grid it saves",
    catalogUp && JSON.stringify(kept) === JSON.stringify(["t:101", "t:102"]) && tiles === 2,
    JSON.stringify({ catalogUp, kept, tiles }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ----------------------- the line fills while the picker is open: choose
{
  for (const id of ["101", "102", "103"]) modes.set(id, "live");
  // Two tiles, and one stream elsewhere on a line of three. Until the count
  // is one taken well after the grid last changed, the elsewhere one isn't
  // believed, so there is room for one; then there isn't.
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN), pickOf(102, SKY)],
    sound: "t:101",
    line: [3, 3],
  });
  await page.keyboard.press("a");
  await page.locator(".mvpick__input").waitFor({ timeout: 5000 });
  await page.locator(".mvpick__input").fill("news");
  await page.waitForFunction(() => /1 elsewhere/.test(document.querySelector(".mvmeter")?.getAttribute("aria-label") ?? ""), null, {
    timeout: 30_000,
  }).catch(() => {});
  const meter = await page.locator(".mvmeter").getAttribute("aria-label").catch(() => "");
  await page.locator(".mvpick__row", { hasText: NEWS }).first().click();
  await page.waitForTimeout(600);
  const prompt = await page.locator(".mvchoose").textContent().catch(() => "");
  const tiles = await page.locator(".mvtile:not(.mvtile--empty)").count();
  check(
    "a channel picked after the line filled asks which tile it replaces, rather than adding nothing",
    /elsewhere/.test(meter ?? "") && /Pick a tile/.test(prompt ?? "") && prompt.includes(NEWS) && tiles === 2,
    JSON.stringify({ meter, prompt, tiles }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------- games that are over, and a score gone old
{
  for (const id of ["101", "102"]) modes.set(id, "live");
  const now = Date.now();
  const status = { clock: 442, displayClock: "7:22", period: 3, type: { id: "2", state: "in", completed: false, shortDetail: "7:22 - 3rd" } };
  const team = (id, name, short, abbr) => ({ id, displayName: name, shortDisplayName: short, abbreviation: abbr, name: short });
  const NFL = {
    id: "401",
    date: new Date(now - 90 * 60_000).toISOString(),
    name: "Buffalo Bills at Kansas City Chiefs",
    shortName: "BUF @ KC",
    status,
    competitions: [
      {
        id: "401",
        date: new Date(now - 90 * 60_000).toISOString(),
        competitors: [
          { id: "12", homeAway: "home", team: team("12", "Kansas City Chiefs", "Chiefs", "KC"), score: "24" },
          { id: "2", homeAway: "away", team: team("2", "Buffalo Bills", "Bills", "BUF"), score: "17" },
        ],
        status,
        broadcasts: [{ market: "national", names: ["ESPN"] }],
      },
    ],
  };
  const { page, ctx, errors } = await openTab({
    grid: [
      { channelId: "t:101", label: "Bills at Chiefs", gameId: "espn-football/nfl-401", league: "football/nfl", start: now - 90 * 60_000 },
      // Last night's game, still on the grid this morning.
      { channelId: "t:102", label: "Jets at Dolphins", gameId: "espn-football/nfl-388", league: "football/nfl", start: now - 13 * 3_600_000 },
    ],
    sound: "t:101",
    espn: (path) => (path.includes("football/nfl") ? [NFL] : []),
    clock: true,
  });
  // A tile shows its information once it plays.
  await opened(page, "101", 1);
  await served("101");
  await page.evaluate(() => document.querySelectorAll("video.mvtile__video").forEach((v) => v.dispatchEvent(new Event("playing"))));
  // The first look at ESPN brings the score.
  await page.waitForFunction(() => /KC/.test(document.querySelector(".mvtile__title")?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
  const picks = await savedGrid(page);
  check(
    "a game tile goes back to being its channel once the game is long over",
    picks.length === 2 && picks[1].gameId === undefined && picks[1].label === SKY && picks[0].gameId === "espn-football/nfl-401",
    JSON.stringify(picks.map((p) => [p.label, p.gameId ?? null])),
  );
  const fresh = await page.locator(".mvtile__gamestatus").first().textContent().catch(() => "");
  // ESPN stops answering; six minutes pass.
  espnDown = true;
  await page.clock.fastForward("06:00");
  await page.waitForTimeout(800);
  const old = await page.locator(".mvtile__gamestatus").first().textContent().catch(() => "");
  check(
    "a score kept through failed looks says when it is from",
    !/as of/.test(fresh ?? "") && /as of /.test(old ?? ""),
    JSON.stringify({ fresh, old }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
