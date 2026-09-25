// E2E: Focus's seam (plan 017, P4b).
//
// What this proves, under the IPC stub the other multi-view harnesses use:
// - Focus opens at the natural split (the big tile exactly as tall as the
//   stack), with a separator in the gap between them;
// - a drag moves the seam 1:1 under the pointer, every picture stays 16:9,
//   nothing overlaps, and no <video> is re-created on the way; the tip and
//   the natural guide show while it moves and go when it stops;
// - it stops at both ends of its range, is remembered across a reload, and
//   a double-click (or `\`) goes back to the natural split;
// - a click that does not move it does not pin it: the natural split still
//   follows the window;
// - `[` and `]` nudge it; focused, ← → move it and not the sound, Home and
//   End take it to the ends; Grid has no seam and ignores the keys.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvseam.mjs
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const GRID = [
  { channelId: "t:101", label: "Fake ESPN 4K" },
  { channelId: "t:102", label: "Fake Sky Sports FHD" },
  { channelId: "t:103", label: "Fake News Channel" },
];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid }) => {
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
      // Seeded once: a reload must find what the page itself saved.
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(
          "blammytv.multiviewGrid",
          JSON.stringify({ v: 1, data: { picks: grid, sound: "t:101" } }),
        );
      }
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
    { port: PORT, grid: GRID },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await enter(page);
  return { page, ctx, errors };
}

async function enter(page) {
  await page.locator('[data-dest="multiview"]').click({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 3, null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);
}

/** Every picture, in order: the big one first in Focus. */
const tiles = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
const seamBox = (page) => page.getByRole("separator", { name: "Big tile size" }).boundingBox();
const seamX = async (page) => {
  const b = await seamBox(page);
  return b ? b.x + b.width / 2 : NaN;
};
const CAP = 30;
/** The big tile and the stack line up top and bottom, captions included. */
const natural = (t) => Math.abs(t[0].y - t[1].y) <= 1.5 && Math.abs(t[0].y + t[0].h - (t[2].y + t[2].h)) <= 1.5;
const sixteenNine = (t) => t.every((r) => Math.abs((r.w * 9) / 16 - r.h) <= 1);
const overlaps = (t) =>
  t.some((a, i) =>
    t.some(
      (b, j) =>
        i < j && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h + CAP - 1 && b.y < a.y + a.h + CAP - 1,
    ),
  );
const rest = (page) => page.mouse.move(W - 200, H - 10);
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
};

{
  const { page, ctx, errors } = await open();
  await rest(page);

  // ------------------------------------------------------------- at rest
  const t0 = await tiles(page);
  const s0 = await seamBox(page);
  check(
    "Focus opens at the natural split, with a separator in the gap",
    natural(t0) &&
      s0 !== null &&
      Math.abs(s0.x + s0.width / 2 - (t0[0].x + t0[0].w + t0[1].x) / 2) <= 1.5,
    JSON.stringify({ t0, s0 }),
  );

  // ---------------------------------------------------------------- drag
  // Mark the videos: a drag must move them, never re-create them.
  await page.evaluate(() =>
    document.querySelectorAll("video.mvtile__video").forEach((v, i) => {
      v.__mark = i + 1;
    }),
  );
  const from = await seamX(page);
  const y = s0.y + s0.height / 2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(from - 120, y, { steps: 6 });
  await page.waitForTimeout(100);
  const mid = await tiles(page);
  const midSeam = await seamX(page);
  const tip = await page.locator(".mvseam-tip").textContent().catch(() => "");
  const guide = await page.locator(".mvseam-guide").count();
  check(
    "a drag moves the seam 1:1 under the pointer, the big tile with it",
    Math.abs(midSeam - (from - 120)) <= 1.5 && Math.abs(mid[0].w - (t0[0].w - 120)) <= 1.5,
    JSON.stringify({ from, midSeam, bigWas: t0[0].w, big: mid[0].w }),
  );
  check(
    "while it moves every picture stays 16:9, the stack grows beside it and nothing overlaps",
    sixteenNine(mid) && !overlaps(mid) && mid[1].w > t0[1].w + 100,
    JSON.stringify(mid),
  );
  check(
    "the tip says how big the big tile is, over a guide at the natural split",
    /^Big tile \d+% · double-click to reset$/.test(tip) && guide === 1,
    JSON.stringify({ tip, guide }),
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await tiles(page);
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll("video.mvtile__video")].map((v) => v.__mark ?? 0).sort(),
  );
  check(
    "letting go keeps it there, puts the tip away, and no video was re-created",
    Math.abs(after[0].w - mid[0].w) <= 1 &&
      (await page.locator(".mvseam-tip").count()) === 0 &&
      JSON.stringify(marks) === "[1,2,3]",
    JSON.stringify({ big: after[0].w, marks }),
  );

  // --------------------------------------------------------- remembered
  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page);
  await rest(page);
  const back = await tiles(page);
  check("it is remembered across a reload", Math.abs(back[0].w - after[0].w) <= 1, `${after[0].w} then ${back[0].w}`);

  // --------------------------------------------------------------- ends
  const stageW = await page.locator(".mvgrid").evaluate((e) => e.clientWidth);
  let at = await seamX(page);
  await page.mouse.move(at, y);
  await page.mouse.down();
  await page.mouse.move(W + 400, y, { steps: 8 });
  await page.mouse.up();
  const wide = await tiles(page);
  at = await seamX(page);
  await page.mouse.move(at, y);
  await page.mouse.down();
  await page.mouse.move(-400, y, { steps: 8 });
  await page.mouse.up();
  const narrow = await tiles(page);
  check(
    "it stops at both ends: the small tiles never under a fifth of the stage, the big one never under half",
    wide[1].w >= stageW / 5 - 1 && narrow[0].w >= (narrow[0].w + narrow[1].w) / 2 - 1 && sixteenNine([...wide, ...narrow]),
    JSON.stringify({ stageW, wideSmall: wide[1].w, narrowBig: narrow[0].w, narrowSmall: narrow[1].w }),
  );

  // -------------------------------------------------------- double-click
  const sb = await seamBox(page);
  await page.mouse.dblclick(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForTimeout(200);
  const reset = await tiles(page);
  check(
    "a double-click on the seam goes back to the natural split",
    natural(reset) && Math.abs(reset[0].w - t0[0].w) <= 1,
    JSON.stringify({ big: reset[0].w, was: t0[0].w }),
  );

  // --------------------------------------------- a click does not pin it
  // A click with no movement must leave "natural" as natural, which then
  // follows the window. A stored number would not.
  await rest(page);
  await page.waitForTimeout(1300); // the double-click's tip goes
  const cb = await seamBox(page);
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.setViewportSize({ width: 1250, height: 900 });
  await page.waitForTimeout(300);
  const smaller = await tiles(page);
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(300);
  check("a click that does not move it leaves the natural split following the window", natural(smaller), JSON.stringify(smaller));

  // ---------------------------------------------------------------- keys
  await rest(page);
  const k0 = (await tiles(page))[0].w;
  await press(page, "]");
  const k1 = (await tiles(page))[0].w;
  const keyTip = await page.locator(".mvseam-tip").count();
  await press(page, "[");
  await press(page, "[");
  const k2 = (await tiles(page))[0].w;
  const across = stageW - 14;
  check(
    "] makes the big tile bigger and [ smaller, 2% of the pictures' width a step, the tip showing",
    Math.abs(k1 - k0 - across * 0.02) <= 1.5 && Math.abs(k0 - k2 - across * 0.02) <= 1.5 && keyTip === 1,
    JSON.stringify({ k0, k1, k2, step: across * 0.02, keyTip }),
  );
  await press(page, "\\");
  check("\\ goes back to the natural split", natural(await tiles(page)) && Math.abs((await tiles(page))[0].w - k0) <= 1, "");

  // ------------------------------------------------- focused, a splitter
  const soundBefore = await page
    .locator(".mvtile.is-on")
    .getAttribute("aria-label")
    .then((l) => l.split(",")[0]);
  await page.getByRole("separator", { name: "Big tile size" }).focus();
  await press(page, "ArrowRight");
  const f1 = (await tiles(page))[0].w;
  const soundAfter = await page
    .locator(".mvtile.is-on")
    .getAttribute("aria-label")
    .then((l) => l.split(",")[0]);
  await press(page, "Home");
  const f2 = await tiles(page);
  const valueNow = await page.getByRole("separator", { name: "Big tile size" }).getAttribute("aria-valuenow");
  const valueMin = await page.getByRole("separator", { name: "Big tile size" }).getAttribute("aria-valuemin");
  check(
    "focused, → moves the seam and not the sound, and Home takes it to its end",
    Math.abs(f1 - k0 - across * 0.02) <= 1.5 &&
      soundAfter === soundBefore &&
      f2[0].w < f1 - 50 &&
      valueNow === valueMin,
    JSON.stringify({ f1, k0, soundBefore, soundAfter, big: f2[0].w, valueNow, valueMin }),
  );
  await press(page, "\\");

  // ---------------------------------------------------------------- Grid
  await page.locator(".mvtile").first().focus();
  await press(page, "g");
  const g0 = await tiles(page);
  await press(page, "]");
  const g1 = await tiles(page);
  check(
    "Grid has no seam, and ignores [ and ]",
    (await page.getByRole("separator").count()) === 0 && JSON.stringify(g0) === JSON.stringify(g1),
    JSON.stringify(g1.map((t) => Math.round(t.w))),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);
