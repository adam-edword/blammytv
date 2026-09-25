// E2E: multi-view tiles get themselves back (plan 018, H1).
//
// Before H1 a tile that lost its stream froze on its last frame, or showed
// the failure and waited for a click, for the rest of the game; a failed
// player kept its connection; the sound could sit on a dead tile. What this
// proves, under the IPC stub the other multi-view harnesses use:
// - a playing tile whose stream drops (cut, or ended cleanly) says it is
//   reconnecting, connects again by itself, and plays;
// - a stream that keeps dying is tried three times, then the tile says why
//   with Retry, having let go of every connection it opened; Retry starts a
//   fresh budget;
// - on a full line a reconnect waits for the panel to show a free slot,
//   asking every few seconds meanwhile, and goes once there is one;
// - a channel that fails on its first connection says so at once and is
//   not retried, and the sound moves off it to a tile that plays;
// - a picture that stops moving is caught and reconnected;
// - four tiles on a line of five is not "your line is at its limit".
//
// The stand-in for mvproxy.rs serves each channel by mode and can cut or end
// any stream on demand. Nothing decodes in the test Chromium: a first frame
// is the `playing` event, and decoded frames are a stubbed count.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvrecover.mjs
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
const TOON = "Toonami Reruns";
const pickOf = (id, label) => ({ channelId: `t:${id}`, label });

/** The tab, with this grid remembered and this line on the panel. */
async function openTab({ grid, sound, line = [0, 3], frames = false }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid, sound, line, frames }) => {
      MediaSource.isTypeSupported = () => true;
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
            if (/player_api\.php/.test(args.url) && !/action=/.test(args.url)) {
              window.__polls++;
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
          ],
        }),
      );
    },
    { port: PORT, grid, sound, line, frames },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  await page.waitForFunction((k) => document.querySelectorAll("video.mvtile__video").length === k, grid.length, {
    timeout: 15_000,
  });
  return { page, ctx, errors };
}

const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);
const stateOf = (page, name) => tile(page, name).getAttribute("data-state");
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

// ------------------------------------------------ a dropped stream comes back
{
  modes.set("101", "live");
  const { page, ctx, errors } = await openTab({ grid: [pickOf(101, ESPN)], sound: "t:101" });
  await opened(page, "101", 1);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(300);
  const before = await stateOf(page, ESPN);

  drop("101", "cut");
  await page.waitForFunction((n) => document.querySelector(`.mvtile[aria-label^="${n},"]`)?.dataset.state === "reconnecting", ESPN, { timeout: 5000 }).catch(() => {});
  const during = await stateOf(page, ESPN);
  const words = await tile(page, ESPN).locator(".mvtile__statetitle").textContent().catch(() => "");
  const again = await opened(page, "101", 2);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(300);
  check(
    "a playing tile whose stream is cut says it is reconnecting, connects again by itself, and plays",
    before === "playing" && during === "reconnecting" && words === `Reconnecting ${ESPN}` && again && (await stateOf(page, ESPN)) === "playing",
    JSON.stringify({ before, during, words, again, after: await stateOf(page, ESPN) }),
  );

  // Ended cleanly: how a stream played straight (no proxy) shows a drop.
  drop("101", "end");
  const ended = await opened(page, "101", 3);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(300);
  check("and one that ends cleanly too: a live stream has no end", ended && (await stateOf(page, ESPN)) === "playing");

  // Now every connection dies young. Two of the three tries are spent;
  // the third goes, and dies, and the tile says why.
  modes.set("101", "dies");
  drop("101", "cut");
  const gaveUp = await page
    .waitForFunction((n) => document.querySelector(`.mvtile[aria-label^="${n},"]`)?.dataset.state === "failed", ESPN, { timeout: 20_000 })
    .then(() => true, () => false);
  const opens = await opensOf(page, "101");
  await page.waitForTimeout(500);
  const { opensAll, closes } = await page.evaluate(() => ({ opensAll: window.__opens.map(([, l]) => l), closes: window.__closes }));
  check(
    "a stream that keeps dying is tried three times, then the tile says why, with Retry",
    gaveUp && opens === 4 && (await tile(page, ESPN).getByRole("button", { name: "Retry" }).count()) === 1,
    JSON.stringify({ gaveUp, opens }),
  );
  check(
    "and it has let go of every connection it opened (a failed player used to keep its own)",
    opensAll.every((l) => closes.includes(l)),
    JSON.stringify({ open: opensAll.filter((l) => !closes.includes(l)) }),
  );

  // Retry by hand: a full budget again.
  modes.set("101", "live");
  await tile(page, ESPN).hover();
  await tile(page, ESPN).getByRole("button", { name: "Retry" }).click();
  const retried = await opened(page, "101", 5);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(300);
  drop("101", "cut");
  const afterRetry = await opened(page, "101", 6);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(300);
  check(
    "Retry starts a fresh budget: the next drop is reconnected, not a failure",
    retried && afterRetry && (await stateOf(page, ESPN)) === "playing",
    JSON.stringify({ retried, afterRetry, state: await stateOf(page, ESPN) }),
  );
  // The element's own word that the stream ended is a drop as well.
  await page.evaluate(
    (n) => document.querySelector(`.mvtile[aria-label^="${CSS.escape(n)},"] video`)?.dispatchEvent(new Event("ended")),
    ESPN,
  );
  check("a video that says it has ended is a drop too", await opened(page, "101", 7));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ----------------------------------------------- a full line: wait for a slot
{
  modes.set("101", "live");
  const { page, ctx, errors } = await openTab({ grid: [pickOf(101, ESPN)], sound: "t:101", line: [3, 3] });
  await opened(page, "101", 1);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(1500);
  const polls0 = await page.evaluate(() => window.__polls);
  drop("101", "cut");
  await page.waitForTimeout(9000);
  const waited = await opensOf(page, "101");
  const polls1 = await page.evaluate(() => window.__polls);
  const state = await stateOf(page, ESPN);
  // The panel notices the old stream has gone.
  await page.evaluate(() => (window.__line = [2, 3]));
  const went = await opened(page, "101", 2, 12_000);
  check(
    "on a full line a reconnect waits for the panel to show a free slot, asking every few seconds",
    waited === 1 && state === "reconnecting" && polls1 - polls0 >= 2,
    JSON.stringify({ opens: waited, state, polls: polls1 - polls0 }),
  );
  check("and goes once there is one", went);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------- a first connection's failure, and the sound
{
  modes.set("102", "403");
  modes.set("101", "live");
  const { page, ctx, errors } = await openTab({ grid: [pickOf(102, SKY), pickOf(101, ESPN)], sound: "t:102" });
  await page.waitForFunction((n) => document.querySelector(`.mvtile[aria-label^="${n},"]`)?.dataset.state === "failed", SKY, { timeout: 10_000 }).catch(() => {});
  await opened(page, "101", 1);
  await served("101");
  await playing(page, ESPN);
  await page.waitForTimeout(4000);
  check(
    "a channel that fails on its first connection says so at once, and is not retried",
    (await stateOf(page, SKY)) === "failed" && (await opensOf(page, "102")) === 1,
    JSON.stringify({ state: await stateOf(page, SKY), opens: await opensOf(page, "102") }),
  );
  const muted = await page.evaluate(() =>
    [...document.querySelectorAll(".mvtile:not(.mvtile--empty)")].map((t) => [
      t.getAttribute("aria-label").split(",")[0],
      t.querySelector("video").muted,
    ]),
  );
  check(
    "the sound leaves the dead tile for one that plays",
    JSON.stringify(muted) === JSON.stringify([[SKY, true], [ESPN, false]]) &&
      ((await tile(page, ESPN).getAttribute("aria-label")) ?? "").includes("sound on"),
    JSON.stringify(muted),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  modes.delete("102");
}

// ------------------------------------------------------- a picture that froze
{
  modes.set("101", "live");
  const { page, ctx, errors } = await openTab({ grid: [pickOf(101, ESPN)], sound: "t:101", frames: true });
  await opened(page, "101", 1);
  await served("101");
  await playing(page, ESPN);
  // Frames move for a few seconds, then stop, the stream still flowing.
  await page.evaluate(() => {
    window.__tick = setInterval(() => window.__frames++, 200);
    setTimeout(() => clearInterval(window.__tick), 5000);
  });
  const caught = await opened(page, "101", 2, 25_000);
  check("a picture that stops moving is caught, and the tile reconnects", caught, `opens ${await opensOf(page, "101")}`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// -------------------------------------------- four tiles on a line of five
{
  for (const id of ["101", "102", "103"]) modes.set(id, "live");
  modes.set("108", "403");
  const { page, ctx, errors } = await openTab({
    grid: [pickOf(101, ESPN), pickOf(102, SKY), pickOf(103, NEWS), pickOf(108, TOON)],
    sound: "t:101",
    line: [4, 5],
  });
  await page.waitForTimeout(3000);
  await page.waitForFunction((n) => document.querySelector(`.mvtile[aria-label^="${n},"]`)?.dataset.state === "failed", TOON, { timeout: 10_000 }).catch(() => {});
  const title = await tile(page, TOON).locator(".mvtile__statetitle").textContent().catch(() => "");
  check(
    "four tiles on a line of five is the grid's ceiling, not the line's: a refusal there isn't \"your line is at its limit\"",
    title === "Your provider refused this one",
    title,
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  modes.delete("108");
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
