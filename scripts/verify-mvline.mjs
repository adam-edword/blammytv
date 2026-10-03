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
// - a score kept through failed looks at ESPN says when it is from;
// - a line caps the grid only when it is the one source enabled (MV1): two
//   lines, or a line beside an M3U, cap nothing and block nothing, and
//   alone a line of one blocks, with A agreeing with Add;
// - with two lines, room is decided per channel by its own line (MV1): a
//   channel on the full line asks which of that line's tiles it replaces
//   (only those can be chosen), one on the other line is added, and the
//   picker marks the first kind;
// - a saved tile whose playlist was deleted or switched off goes once the
//   catalog has loaded, and not before (MV3).
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
async function openTab({
  grid,
  sound,
  line = [0, 3],
  frames = false,
  espn = null,
  clock = false,
  catalogDown = false,
  m3u = false,
  lax = false,
  // More playlists beside "t", as saved; and the line each Xtream username's
  // panel reports, [in use, allowed], where it isn't `line`.
  extra = [],
  lineBy = null,
  // The catalog's channels held back until the test releases them: a cold
  // launch, before the catalog has loaded.
  holdCatalog = false,
  // Start on the Guide rather than the tab, to send a channel from there.
  start = "multiview",
}) {
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
    ({ port, grid, sound, line, frames, catalogDown, m3u, extra, lineBy, holdCatalog }) => {
      MediaSource.isTypeSupported = () => true;
      window.__catalogDown = catalogDown;
      window.__lineBy = lineBy;
      if (holdCatalog) window.__holdCatalog = new Promise((r) => (window.__release = r));
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
            if (window.__holdCatalog && /action=get_live_streams/.test(args.url))
              return window.__holdCatalog.then(() => fetch(args.url).then((r) => r.arrayBuffer()));
            if (/player_api\.php/.test(args.url) && !/action=/.test(args.url)) {
              window.__polls++;
              if (window.__pollFails) return Promise.reject(new Error("panel timed out"));
              // Held from the test, after the catalog is in: the count is
              // what the tab is waiting on.
              return (window.__holdPoll ?? Promise.resolve())
                .then(() => fetch(args.url))
                .then((r) => r.json())
                .then((j) => {
                  const user = new globalThis.URL(args.url).searchParams.get("username");
                  const [active, max] = window.__lineBy?.[user] ?? window.__line;
                  j.user_info.active_cons = String(active);
                  j.user_info.max_connections = String(max);
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
            ...extra,
          ],
        }),
      );
    },
    { port: PORT, grid, sound, line, frames, catalogDown, m3u, extra, lineBy, holdCatalog },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  if (start === "guide") {
    await goTo(page, "guide");
    await page.locator(".guide__row").first().waitFor({ timeout: 20_000 });
    return { page, ctx, errors };
  }
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

// --------------- MV1: a line caps the grid only when it is the only source
//
// Two Xtream lines, "t" (panel user u) and "v", answer different limits, and
// neither caps the grid: every tile can sit on the line of one and Add is
// still offered. What each line has room for is decided per channel, by its
// own line, as it joins (mvGrid.placeFor): see the sections below.
// An empty grid with an M3U beside a line of one used to take that line,
// which hid Add and dropped a channel sent from the Guide. Each case then
// switches a source off from "Settings" and expects the cap to arrive, which
// is also what shows the counts had answered all along.
const SECOND = { kind: "xtream", id: "v", name: "Second", enabled: true, server: "http://localhost:8081", username: "v", password: "p" };
const addButton = (page) => page.getByRole("button", { name: "Add channel" });
/** Press A and say whether the picker opened (closing it again if so). */
async function aOpensPicker(page) {
  await page.keyboard.press("a");
  const opened = await page.locator(".mvpick__input").waitFor({ timeout: 1200 }).then(() => true, () => false);
  if (opened) {
    await page.keyboard.press("Escape");
    await page.locator(".mvpick__input").waitFor({ state: "detached" }).catch(() => {});
  }
  return opened;
}
/** The panels have been asked and have had time to answer. */
const answered = async (page, polls) => {
  await page.waitForFunction((n) => window.__polls >= n, polls, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1200);
};
/** A playlist switched off, as Settings does it: saved, and announced. */
const switchOff = (page, id) =>
  page.evaluate((off) => {
    const k = "blammytv.playlists";
    const j = JSON.parse(localStorage.getItem(k));
    j.data = j.data.map((p) => (p.id === off ? { ...p, enabled: false } : p));
    localStorage.setItem(k, JSON.stringify(j));
    window.dispatchEvent(new CustomEvent("blammytv:playlists"));
  }, id);
/** What the bar says about the line and Add, as the page shows it. */
const barState = async (page) => ({
  blocked: await page.locator(".mvtab__blocked").count(),
  meter: await page.locator(".mvmeter").getAttribute("aria-label").catch(() => null),
  add: await addButton(page).count(),
  refuses: await addButton(page).getAttribute("aria-disabled").catch(() => null),
});
/** Right-click a Guide row's card and send it to multi-view. */
async function sendFromGuide(page, row) {
  await row.waitFor({ timeout: 20_000 });
  await row.locator(".guide__card").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to multi-view" }).click();
  await page.locator(".mvtab").waitFor({ timeout: 10_000 });
}
{
  // Every tile on the line of one, a second line enabled: not capped, not blocked.
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN)],
    sound: "t:101",
    extra: [SECOND],
    lineBy: { u: [0, 1], v: [0, 5] },
    lax: true,
  });
  await answered(page, 2);
  const two = await barState(page);
  const opened = await aOpensPicker(page);
  check(
    "two lines, every tile on the line of one: not capped and not blocked, Add is offered and A opens it",
    two.blocked === 0 && two.meter === "1 stream" && two.add === 1 && two.refuses === "false" && opened,
    JSON.stringify({ ...two, opened }),
  );
  // The second line off: the line of one is the only source, and blocks as it always did.
  await switchOff(page, "v");
  const blocked = await page.locator(".mvtab__blocked").waitFor({ timeout: 8000 }).then(() => true, () => false);
  const alone = await barState(page);
  const openedAlone = await aOpensPicker(page);
  check(
    "and with the second line off, the line of one is the only source: blocked, Add gone, A does not open it",
    blocked && alone.add === 0 && !openedAlone,
    JSON.stringify({ blocked, ...alone, openedAlone }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  // A line of two with both its streams on the grid, a second line enabled: not capped.
  const { page, ctx } = await openTab({
    grid: [pickOf(101, ESPN), pickOf(102, SKY)],
    sound: "t:101",
    extra: [SECOND],
    lineBy: { u: [0, 2], v: [0, 5] },
    lax: true,
  });
  await answered(page, 2);
  const two = await barState(page);
  const opened = await aOpensPicker(page);
  check(
    "two lines, every tile on a line of two: not capped, Add is open",
    two.blocked === 0 && two.meter === "2 streams" && two.refuses === "false" && opened,
    JSON.stringify({ ...two, opened }),
  );
  await switchOff(page, "v");
  await page
    .waitForFunction(() => /2 of 2 streams/.test(document.querySelector(".mvmeter")?.getAttribute("aria-label") ?? ""), null, { timeout: 8000 })
    .catch(() => {});
  const alone = await barState(page);
  const openedAlone = await aOpensPicker(page);
  check(
    "and alone, the line of two caps the grid: the meter reads it, Add refuses, A does not open it",
    /2 of 2 streams/.test(alone.meter ?? "") && alone.refuses === "true" && !openedAlone,
    JSON.stringify({ ...alone, openedAlone }),
  );
  await ctx.close();
}
{
  // Every tile on the roomy line is not held to it either, and is when it is alone.
  const { page, ctx } = await openTab({
    grid: [{ channelId: "v:101", label: ESPN }],
    sound: "v:101",
    extra: [SECOND],
    lineBy: { u: [0, 1], v: [0, 5] },
    lax: true,
  });
  await answered(page, 2);
  const two = await barState(page);
  await switchOff(page, "t");
  await page
    .waitForFunction(() => /of 5 streams/.test(document.querySelector(".mvmeter")?.getAttribute("aria-label") ?? ""), null, { timeout: 8000 })
    .catch(() => {});
  const alone = await barState(page);
  check(
    "every tile on the line of five: no cap beside another line, the meter reads five when it is alone",
    two.meter === "1 stream" && two.blocked === 0 && /1 of 5 streams/.test(alone.meter ?? "") && alone.refuses === "false",
    JSON.stringify({ two, alone }),
  );
  await ctx.close();
}
{
  // Tiles on both lines: no single cap, as it was (L4).
  const { page, ctx } = await openTab({
    grid: [pickOf(101, ESPN), { channelId: "v:102", label: SKY }],
    sound: "t:101",
    extra: [SECOND],
    lineBy: { u: [0, 1], v: [0, 5] },
    lax: true,
  });
  await answered(page, 2);
  const two = await barState(page);
  check(
    "tiles on two lines: no cap, no block (the counts have answered)",
    two.blocked === 0 && two.meter === "2 streams" && two.refuses === "false",
    JSON.stringify(two),
  );
  await ctx.close();
}
{
  // An empty grid, a line of one, and an M3U beside it.
  const { page, ctx, errors } = await openTab({ grid: [], sound: null, line: [0, 1], m3u: true });
  await answered(page, 1);
  const withM3u = await barState(page);
  const openedWith = await aOpensPicker(page);
  check(
    "an empty grid with an M3U beside a line of one is not blocked: Add is open and A opens it",
    withM3u.blocked === 0 && withM3u.refuses === "false" && openedWith,
    JSON.stringify({ ...withM3u, openedWith }),
  );
  // The M3U switched off from Settings: the line of one is the only source.
  await switchOff(page, "m");
  const blockedAlone = await page.locator(".mvtab__blocked").waitFor({ timeout: 8000 }).then(() => true, () => false);
  const offeredAlone = await addButton(page).count();
  const openedAlone = await aOpensPicker(page);
  check(
    "and with the M3U off, the line of one is the only source: blocked, Add gone, A does not open it",
    blockedAlone && offeredAlone === 0 && !openedAlone,
    JSON.stringify({ blockedAlone, offeredAlone, openedAlone }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  // A channel sent from the Guide to a grid wholly on the line of one, with a
  // second line enabled: its line is full, so the grid asks which of that
  // line's tiles it replaces. It used to join, past the line.
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN)],
    sound: "t:101",
    extra: [SECOND],
    lineBy: { u: [0, 1], v: [0, 5] },
    start: "guide",
  });
  await sendFromGuide(page, page.locator('.guide__row[data-channel="t:103"]'));
  const asked = await page.locator(".mvchoose").waitFor({ timeout: 8000 }).then(() => true, () => false);
  const prompt = await page.locator(".mvchoose").textContent().catch(() => "");
  const waiting = (await savedGrid(page)).map((p) => p.channelId);
  const after = await barState(page);
  await page.locator('[data-mv="tile:t:101"]').click();
  await page.waitForFunction(() => !document.querySelector(".mvchoose"), null, { timeout: 5000 }).catch(() => {});
  const swapped = (await savedGrid(page)).map((p) => p.channelId);
  check(
    "a channel sent from the Guide to a grid on the line of one asks which tile it replaces, and replaces it",
    asked && /^Pick a tile for Fake News Channel/.test(prompt ?? "") && JSON.stringify(waiting) === JSON.stringify(["t:101"]) &&
      after.blocked === 0 && JSON.stringify(swapped) === JSON.stringify(["t:103"]),
    JSON.stringify({ asked, prompt, waiting, swapped, ...after }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// -------------------------------- MV1: room per line, decided per channel
//
// "t" allows one stream, "v" five, both enabled: no single cap (above). The
// grid asks about a channel by ITS line: one on the full line asks which of
// that line's tiles it replaces, one on the other line is added. Both lines
// carry the same channels (one fake panel), so a name appears twice, the
// first from "t" and the second from "v"; which is which is shown by what
// each does, not taken on trust from the order.
const LINES = { u: [0, 1], v: [0, 5] };
/** Open the picker with A, search, and wait for the rows. */
async function searchPicker(page, query) {
  // The last one may still be fading out: its input is not the next one's.
  await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.keyboard.press("a");
  await page.locator(".mvpick__input").waitFor({ timeout: 5000 });
  await page.locator(".mvpick__input").fill(query);
  const rows = page.locator(".mvpick__row");
  await rows.nth(1).waitFor({ timeout: 5000 });
  return rows;
}
const tileIds = async (page) => (await savedGrid(page)).map((p) => p.channelId);
{
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN)],
    sound: "t:101",
    extra: [SECOND],
    lineBy: LINES,
    lax: true,
  });
  await answered(page, 2);
  const nTiles = () => page.locator(".mvtile:not(.mvtile--empty)").count();

  // Every tile on the line of one, a channel from that line: choose among its tiles.
  let rows = await searchPicker(page, "sky");
  const fullNote = await rows.nth(0).locator(".mvpick__replaces").count();
  const roomyNote = await rows.nth(1).locator(".mvpick__replaces").count();
  await rows.nth(0).click();
  const asked = await page.locator(".mvchoose").waitFor({ timeout: 5000 }).then(() => true, () => false);
  const prompt = await page.locator(".mvchoose").textContent().catch(() => "");
  check(
    "two lines, every tile on the line of one: a channel on that line asks which tile it replaces",
    asked && /^Pick a tile for Fake Sky Sports FHD/.test(prompt ?? "") && (await tileIds(page)).join() === "t:101" && (await nTiles()) === 1,
    JSON.stringify({ asked, prompt, grid: await tileIds(page) }),
  );
  check(
    "  and the picker's row for it said so, where the other line's did not",
    fullNote === 1 && roomyNote === 0,
    JSON.stringify({ fullNote, roomyNote }),
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".mvchoose"), null, { timeout: 3000 }).catch(() => {});

  // The same grid, the same name on the other line: added, nothing to choose.
  rows = await searchPicker(page, "sky");
  await rows.nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 2, null, { timeout: 5000 }).catch(() => {});
  check(
    "  and a channel on the other line is added, with nothing to choose",
    (await tileIds(page)).sort().join() === "t:101,v:102" && (await page.locator(".mvchoose").count()) === 0,
    JSON.stringify({ grid: await tileIds(page) }),
  );

  // A tile on each line now: a channel from the full line may replace only the tile on its own.
  rows = await searchPicker(page, "news");
  const footer = await page.locator(".mvpick__room").textContent().catch(() => "");
  const notes = [await rows.nth(0).locator(".mvpick__replaces").count(), await rows.nth(1).locator(".mvpick__replaces").count()];
  await rows.nth(0).click();
  await page.locator(".mvchoose").waitFor({ timeout: 5000 }).catch(() => {});
  const subset = await page.locator(".mvchoose").textContent().catch(() => "");
  const off = await page.locator(".mvtile.is-pickoff").evaluateAll((els) => els.map((e) => e.getAttribute("data-mv")));
  const tabs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".mvtile:not(.mvtile--empty)")].map((e) => [e.getAttribute("data-mv"), e.getAttribute("tabindex")])));
  check(
    "  with a tile on each line, only the full line's tiles can be chosen: the other line's is dimmed and skipped by Tab",
    JSON.stringify(off) === JSON.stringify(["tile:v:102"]) && tabs["tile:v:102"] === "-1" && tabs["tile:t:101"] === "0",
    JSON.stringify({ off, tabs }),
  );
  check(
    "  and the bar says why, naming the line",
    /^Pick a tile on Test for Fake News Channel/.test(subset ?? ""),
    JSON.stringify(subset),
  );
  check(
    "  and with several sources the picker says what the grid has room for, and marks the full line's row only",
    /^2 more fit in the grid$/.test(footer ?? "") && notes.join() === "1,0",
    JSON.stringify({ footer, notes }),
  );
  // Nothing happens on the tile it may not replace, by pointer or by key.
  await page.locator('[data-mv="tile:v:102"]').click();
  const order = await tileIds(page);
  await page.keyboard.press(String(order.indexOf("v:102") + 1));
  await page.waitForTimeout(400);
  check(
    "  a click on the tile it may not replace, or its number, changes nothing",
    (await page.locator(".mvchoose").count()) === 1 && (await tileIds(page)).sort().join() === "t:101,v:102",
    JSON.stringify({ grid: await tileIds(page) }),
  );
  await page.locator('[data-mv="tile:t:101"]').click();
  await page.waitForFunction(() => !document.querySelector(".mvchoose"), null, { timeout: 5000 }).catch(() => {});
  check(
    "  and choosing its own replaces it",
    (await tileIds(page)).sort().join() === "t:103,v:102" && (await nTiles()) === 2,
    JSON.stringify({ grid: await tileIds(page) }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  // A channel from the Guide on the other line joins, as one on the full line asks.
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN)],
    sound: "t:101",
    extra: [SECOND],
    lineBy: LINES,
    start: "guide",
  });
  await sendFromGuide(page, page.locator('.guide__row[data-channel="v:103"]'));
  const joined = await page
    .waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 2, null, { timeout: 8000 })
    .then(() => true, () => false);
  check(
    "a channel sent from the Guide on the other line joins the grid, with nothing to choose",
    joined && (await tileIds(page)).sort().join() === "t:101,v:103" && (await page.locator(".mvchoose").count()) === 0,
    JSON.stringify({ joined, grid: await tileIds(page) }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  // A tile on each line, a channel from the full line sent from the Guide: its tiles only.
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN), { channelId: "v:102", label: SKY }],
    sound: "t:101",
    extra: [SECOND],
    lineBy: LINES,
    start: "guide",
  });
  await sendFromGuide(page, page.locator('.guide__row[data-channel="t:103"]'));
  const asked = await page.locator(".mvchoose").waitFor({ timeout: 8000 }).then(() => true, () => false);
  const prompt = await page.locator(".mvchoose").textContent().catch(() => "");
  const off = await page.locator(".mvtile.is-pickoff").evaluateAll((els) => els.map((e) => e.getAttribute("data-mv")));
  check(
    "a channel sent from the Guide on the full line may replace only that line's tiles",
    asked && /^Pick a tile on Test for Fake News Channel/.test(prompt ?? "") && JSON.stringify(off) === JSON.stringify(["tile:v:102"]),
    JSON.stringify({ asked, prompt, off }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------- MV1: a channel sent from the Guide to an empty grid, M3U beside
{
  const sendWeather = (page) =>
    sendFromGuide(page, page.locator(".guide__row", { hasText: "Fake Weather Now" }).first());
  const tiles = (page) => page.locator(".mvtile:not(.mvtile--empty)").count();
  {
    const { page, ctx, errors } = await openTab({ grid: [], sound: null, line: [0, 1], m3u: true, start: "guide" });
    await sendWeather(page);
    const joined = await page
      .waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 1, null, { timeout: 5000 })
      .then(() => true, () => false);
    await answered(page, 2);
    const saved = (await savedGrid(page)).map((p) => p.channelId);
    check(
      "a channel sent from the Guide joins an empty grid with a line of one and an M3U beside it, and stays once the count lands",
      joined && (await tiles(page)) === 1 && saved.length === 1 && saved[0].startsWith("m:") && (await page.locator(".mvtab__blocked").count()) === 0,
      JSON.stringify({ joined, saved }),
    );
    check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
  {
    // The panel never answers: the grid has no line to wait for (it has an
    // M3U beside it), so the channel joins at once, not after LINE_WAIT_MS.
    const { page, ctx } = await openTab({ grid: [], sound: null, line: [0, 1], m3u: true, start: "guide" });
    await page.evaluate(() => {
      window.__holdPoll = new Promise((r) => (window.__releasePoll = r));
    });
    await sendWeather(page);
    const t0 = Date.now();
    const joined = await page
      .waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 1, null, { timeout: 2200 })
      .then(() => true, () => false);
    check(
      "and with the panel not answering it joins without waiting out the line",
      joined,
      `${Date.now() - t0}ms`,
    );
    await page.evaluate(() => window.__releasePoll());
    await ctx.close();
  }
}

// ---------------- MV3: a tile on a playlist that is deleted or off goes
{
  // "x" was deleted; "v" is switched off. Neither has a group in the catalog.
  const gone = { channelId: "x:101", label: "Fake Sky Sports FHD" };
  const off = { channelId: "v:101", label: "Fake News Channel" };
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN), gone, off],
    sound: "x:101",
    extra: [{ ...SECOND, enabled: false }],
    holdCatalog: true,
    lax: true,
  });
  // A cold launch: the catalog has not loaded, so the grid is as it was left.
  await page.waitForTimeout(1500);
  // In any order: Focus brings the sound tile to the front.
  const coldSaved = (await savedGrid(page)).map((p) => p.channelId).sort();
  const coldTiles = await page.locator(".mvtile:not(.mvtile--empty)").count();
  check(
    "before the catalog has loaded, a saved grid keeps every tile",
    coldTiles === 3 && JSON.stringify(coldSaved) === JSON.stringify(["t:101", "v:101", "x:101"]),
    JSON.stringify({ coldTiles, coldSaved }),
  );
  await page.evaluate(() => window.__release());
  const dropped = await page
    .waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 1, null, { timeout: 15_000 })
    .then(() => true, () => false);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.multiviewGrid") ?? "null")?.data);
  check(
    "once it has, the tiles of a deleted playlist and a switched-off one are dropped, and the sound with them",
    dropped && JSON.stringify(saved?.picks?.map((p) => p.channelId)) === JSON.stringify(["t:101"]) && saved?.sound !== "x:101",
    JSON.stringify({ dropped, saved }),
  );
  check("  no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
