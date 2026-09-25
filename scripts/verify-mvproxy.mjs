// E2E: multi-view reads live streams through the native proxy (v0.9.101).
//
// Adam's provider stopped sending Access-Control-Allow-Origin, so a tile that
// fetched the stream itself died on every channel. In the shell, the tile
// now asks mv_proxy_open (mvproxy.rs) for a loopback URL and reads that.
// The Rust half is tested in mvproxy.rs, against a fake provider that 302s
// with no CORS header; this is the frontend half, under the IPC stub
// verify-live-idle uses:
// - the tile reads from the URL mv_proxy_open returned, never the provider;
// - leaving multi-view hands it back: mv_proxy_close gets the same URL, and
//   the connection to it closes (a held stream counts against the line's cap);
// - a native build from before the proxy (no such command) falls back to
//   reading the provider directly, as it did before.
// The loopback side is a server in this script: it stands in for mvproxy.rs
// and serves MPEG-TS-shaped bytes with the CORS header.
//
// v0.9.102 adds the stutter probe: btvMultiviewStats() reports a line per
// playing tile, and btvMultiviewTune() restarts playing tiles on the other
// buffering profile (a fresh proxy URL, the old one handed back).
//
// The test Chromium has no H.264, so MediaSource.isTypeSupported is stubbed
// for mpegts.isSupported(). What is asserted is where the bytes come from,
// not that they decode.
//
// v0.9.112: a webview that can't play HEVC (WebView2 without Windows' HEVC
// extension, Adam's) asks the proxy to convert it (mvconvert.rs, tested
// there against a real ffmpeg); one that can, doesn't.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvproxy.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// The stand-in for mvproxy.rs's loopback server.
const hits = [];
let closed = 0;
const proxy = http.createServer((rq, rs) => {
  hits.push(rq.url);
  rs.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Access-Control-Allow-Origin": "*",
  });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => {
    clearInterval(t);
    closed++;
  });
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** The app under the IPC stub; `proxyMode` "missing" plays an old build.
 * `hevc`: whether this webview says it can play HEVC. */
async function open(proxyMode, hevc = true) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // Offline, as the dev container always is (CLAUDE.md).
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const requested = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.addInitScript(
    ({ port, mode, hevc }) => {
      MediaSource.isTypeSupported = (m) => hevc || !/hvc1|hev1/.test(m);
      window.__calls = [];
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
          if (cmd === "mv_proxy_open") {
            window.__calls.push([cmd, args.url, args.convertHevc]);
            if (mode === "missing")
              return Promise.reject(new Error("command mv_proxy_open not found"));
            return Promise.resolve(`http://127.0.0.1:${port}/mv/tok${++n}`);
          }
          if (cmd === "mv_proxy_close") window.__calls.push([cmd, args.local]);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
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
    { port: PORT, mode: proxyMode, hevc },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // Its own tab since plan 017, between Guide and Sports.
  await page.locator('[data-dest="multiview"]').click({ timeout: 30_000 });
  // The picker (plan 017, P3): the empty place opens it, the row adds.
  await page.locator(".mvtile--empty").click();
  await page.locator(".mvpick__input").fill("fake");
  await page.locator(".mvpick__row", { hasText: "Fake ESPN 4K" }).first().click();
  return { page, ctx, errors, requested };
}

const calls = (page) => page.evaluate(() => window.__calls);
// The provider's stream path, on the fake panel. Not just "/live/": vite
// serves the app's own modules from /src/features/live/.
const direct = (urls) => urls.filter((u) => u.startsWith("http://localhost:8081/live/"));

{
  const { page, ctx, errors, requested } = await open("present");
  await page.waitForFunction(() => window.__calls.some(([c]) => c === "mv_proxy_open"), null, {
    timeout: 10_000,
  }).catch(() => {});
  const t = Date.now();
  while (!hits.length && Date.now() - t < 10_000) await page.waitForTimeout(100);
  const opened = (await calls(page)).filter(([c]) => c === "mv_proxy_open");
  check(
    "in the shell, the tile asks the proxy for its stream",
    opened.length === 1 && /\/live\/u\/p\/\d+\.ts$/.test(opened[0][1]),
    JSON.stringify(opened.map(([, u]) => u.replace(/\/live\/.*$/, "/live/…"))),
  );
  check("and reads from the loopback URL it got back", hits.includes("/mv/tok1"), JSON.stringify(hits));
  check(
    "a webview that plays HEVC does not ask for it to be converted",
    opened[0]?.[2] === false,
    JSON.stringify(opened[0]?.[2]),
  );
  check(
    "never from the provider directly",
    direct(requested).length === 0,
    `${direct(requested).length} direct requests`,
  );

  // The stutter probe. Nothing decodes here (no H.264), so this proves the
  // probe finds the playing tile and reports, not what the numbers are.
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.evaluate(() => window.btvMultiviewStats(1));
  const line = logs.find((l) => l.startsWith('[mv] "Fake ESPN 4K":'));
  check(
    "btvMultiviewStats reports the playing tile",
    !!line && /jumps, \d+ stalls .* frames dropped .* buffer ahead/.test(line),
    line ?? logs.join(" | "),
  );
  // v0.9.103: a timeline under each tile, and one for the page's main thread,
  // for a stutter that comes every 20 to 30 seconds.
  check(
    "and a timeline of hitches and events under it, plus the main thread's",
    logs.some((l) => /^\[mv\] {3}hitches: .* \| events: /.test(l)) &&
      logs.some((l) => l.startsWith("[mv] main-thread tasks over 100ms: ")),
    logs.filter((l) => l.startsWith("[mv]")).join(" | "),
  );
  // Switching profile restarts the tile: its URL goes back, a new one opens.
  await page.evaluate(() => window.btvMultiviewTune("chase"));
  const t3 = Date.now();
  while (!hits.includes("/mv/tok2") && Date.now() - t3 < 10_000) await page.waitForTimeout(100);
  const afterTune = await calls(page);
  check(
    "btvMultiviewTune restarts the tile on a fresh proxy URL",
    afterTune.some(([c, u]) => c === "mv_proxy_close" && u.endsWith("/mv/tok1")) &&
      hits.includes("/mv/tok2"),
    JSON.stringify(afterTune.map(([c, u]) => `${c} ${u.replace(/.*\/mv\//, "")}`)),
  );

  // Leaving the tab is the way out now; there is no close button.
  await page.locator('[data-dest="guide"]').click();
  const t2 = Date.now();
  while (closed < 2 && Date.now() - t2 < 5_000) await page.waitForTimeout(100);
  const released = (await calls(page)).filter(([c]) => c === "mv_proxy_close");
  check(
    "leaving the Multi-view tab hands the URL back",
    released.length === 2 && released[1][1] === `http://127.0.0.1:${PORT}/mv/tok2`,
    JSON.stringify(released),
  );
  check("and the connection to it closes", closed >= 2, `${closed} closed`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

{
  const { page, ctx } = await open("present", false);
  await page.waitForFunction(() => window.__calls.some(([c]) => c === "mv_proxy_open"), null, {
    timeout: 10_000,
  }).catch(() => {});
  const opened = (await calls(page)).filter(([c]) => c === "mv_proxy_open");
  check(
    "one that can't play HEVC asks the proxy to convert it",
    opened.length === 1 && opened[0][2] === true,
    JSON.stringify(opened.map(([, , h]) => h)),
  );
  await ctx.close();
}

{
  const before = hits.length;
  const { page, ctx, requested } = await open("missing");
  const t = Date.now();
  while (!direct(requested).length && Date.now() - t < 10_000) await page.waitForTimeout(100);
  check(
    "a native build without the proxy falls back to the direct URL",
    direct(requested).length >= 1 && hits.length === before,
    `${direct(requested).length} direct, ${hits.length - before} proxied`,
  );
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
