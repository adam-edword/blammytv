// What does dragging the VOD scrubber cost? (plan 011)
//
// onPointerMove -> setScrub(...) -> a full TheaterOverlay re-render, once per
// pointer event, and scrubFrac() reads getBoundingClientRect() each time,
// which forces synchronous layout. A gaming mouse reports at 125-1000Hz. This
// drives a realistic drag across the track and measures the main thread.
//
// Control arm drags over a NON-interactive part of the chrome (same pointer
// events, same rate, no setScrub), so the delta is the scrub state cost.
//
// Baseline, 2026-08-07, 375 moves at 125Hz, headless with no video decoding:
//   control  script  59ms  style  4ms  layout  0ms  task  224ms
//   drag     script 347ms  style 27ms  layout 91ms  task 1004ms
//   -> 780ms of main thread over the drag, 12% of one core while held.
// The layout column is the tell: 0ms without scrubbing, 91ms with.
//
// Run:
//   pnpm --filter @blammytv/app build
//   pnpm --filter @blammytv/app preview            # serves :4173
//   npm i playwright-core   (anywhere, e.g. the session scratchpad)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/measure-scrub.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/?overlay=1";
const DRAG_MS = 3000;
const HZ = 125; // a bog-standard USB mouse; gaming mice are 1000

const mockBridge = () => {
  let timeCbs = [];
  let lastTime = { pos: 1200, dur: 5400 };
  window.__pushTime = (t) => {
    lastTime = t;
    timeCbs.slice().forEach((cb) => cb(t));
  };
  const unsub = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {},
    seekAbs() {}, setSpeed() {}, expand() {}, collapse() {}, fullscreen() {},
    exitFullscreen() {}, popout() {}, toggleFavorite() {}, goLive() {},
    setMouseIgnore() {}, selectAudio() {}, selectSub() {},
    getMeta: () =>
      Promise.resolve({
        channelName: "Measured",
        title: "A Feature Length Film",
        live: false,
      }),
    onMeta: unsub(), onLoading: unsub(), onKey: unsub(),
    getLoading: () => false,
    getTracks: () => ({
      audio: [
        { id: 1, label: "English", lang: "eng", selected: true },
        { id: 2, label: "Español", lang: "spa", selected: false },
      ],
      subs: Array.from({ length: 12 }, (_, i) => ({
        id: 10 + i, label: `Sub ${i + 1}`, lang: "eng", selected: false,
      })),
    }),
    onTracks: unsub(),
    getChapters: () => Array.from({ length: 14 }, (_, i) => ({
      title: `Chapter ${i + 1}`, start: i * 300,
    })),
    onChapters: unsub(),
    getTime: () => lastTime,
    onTime(cb) {
      timeCbs.push(cb);
      return () => { timeCbs = timeCbs.filter((x) => x !== cb); };
    },
  };
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  screen: { width: 1920, height: 1080 },
});

async function run(label, { scrub }) {
  const page = await ctx.newPage();
  await page.route("**://*.espncdn.com/**", (r) => r.abort());
  await page.addInitScript(mockBridge);
  await page.goto(URL);
  await page.waitForSelector(".theater-overlay");
  // Wake the chrome so the seek bar is up and interactive.
  await page.mouse.move(640, 360);
  await page.mouse.move(641, 361);
  await page.waitForSelector(".theater-seek__track--vod");
  const box = await page.locator(".theater-seek__track--vod").boundingBox();
  if (!box) throw new Error("no seek track");

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const read = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const g = (n) => metrics.find((m) => m.name === n)?.value ?? 0;
    return { script: g("ScriptDuration"), style: g("RecalcStyleDuration"),
             layout: g("LayoutDuration"), task: g("TaskDuration") };
  };

  // Long tasks = the thing that actually shows up as stutter.
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
    }).observe({ entryTypes: ["longtask"] });
  });

  const y = box.y + box.height / 2;
  const x0 = box.x + 4;
  const x1 = box.x + box.width - 4;
  const steps = Math.round((DRAG_MS / 1000) * HZ);

  await page.mouse.move(x0, y);
  const before = await read();
  const t0 = Date.now();
  // scrub=false drags at the same rate over the title area instead — pointer
  // events still fire, nothing sets scrub state.
  if (scrub) await page.mouse.down();
  for (let i = 0; i <= steps; i++) {
    const f = 0.5 - 0.5 * Math.cos((i / steps) * Math.PI * 4); // back and forth
    await page.mouse.move(x0 + (x1 - x0) * f, scrub ? y : box.y - 90);
  }
  if (scrub) await page.mouse.up();
  const wall = Date.now() - t0;
  const after = await read();
  const long = await page.evaluate(() => window.__long);
  await page.close();

  const d = (k) => (after[k] - before[k]) * 1000;
  return { label, steps, wall, script: d("script"), style: d("style"),
           layout: d("layout"), task: d("task"), long };
}

const control = await run("pointer moves, no scrub (control)", { scrub: false });
const drag = await run("dragging the scrubber", { scrub: true });
await browser.close();

const row = (r) =>
  `  ${r.label.padEnd(34)} script ${r.script.toFixed(0).padStart(5)}ms  ` +
  `style ${r.style.toFixed(0).padStart(4)}ms  layout ${r.layout.toFixed(0).padStart(4)}ms  ` +
  `task ${r.task.toFixed(0).padStart(5)}ms`;

console.log(`\nVOD scrubber drag — ${control.steps} pointer moves at ~${HZ}Hz\n`);
console.log(row(control));
console.log(row(drag));
const dTask = drag.task - control.task;
console.log(
  `\n  scrubbing costs ${dTask.toFixed(0)}ms of main thread over the drag ` +
    `(${((dTask / drag.wall) * 100).toFixed(0)}% of one core while held)`,
);
const longs = drag.long.filter((d) => d >= 50);
console.log(
  `  long tasks >=50ms during drag: ${longs.length}` +
    (longs.length ? ` (worst ${Math.max(...longs)}ms)` : "") +
    `, control: ${control.long.filter((d) => d >= 50).length}\n`,
);
