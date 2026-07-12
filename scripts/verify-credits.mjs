// Seam verify: TheaterOverlay's creditsWindow signal (v0.3.36).
// Mounts the overlay standalone (?overlay=1) against a mocked overlayApi
// and proves:
//   1. AniSkip 'ed' interval → creditsWindow(true) on entry, (false) on exit
//   2. 'op' intervals never fire it
//   3. Chapter fallback: CREDITS_RX-titled chapter in the last 40% fires;
//      an early "ED"-titled chapter (an OP mislabel) does NOT
//   4. Signal fires even with skipBehavior=hidden (chip pref ≠ signal)
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/?overlay=1";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// meta.skips / chapters are per-scenario; injected via evaluate.
const mockBridge = () => {
  const calls = [];
  window.__credits = calls; // [active, active, ...] in fire order
  let timeCbs = [];
  let chapterCbs = [];
  let metaCbs = [];
  let lastTime = null;
  let lastChapters = [];
  let meta = { channelName: "T", title: "Ep", live: false };
  window.__pushTime = (t) => {
    lastTime = t;
    timeCbs.slice().forEach((cb) => cb(t));
  };
  window.__pushChapters = (c) => {
    lastChapters = c;
    chapterCbs.slice().forEach((cb) => cb(c));
  };
  window.__setMeta = (m) => {
    meta = m;
    metaCbs.slice().forEach((cb) => cb(m));
  };
  const unsub = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {},
    seekAbs() {}, setSpeed() {}, expand() {}, collapse() {}, fullscreen() {},
    exitFullscreen() {}, popout() {}, sourcePanel() {}, toggleFavorite() {},
    goLive() {}, setMouseIgnore() {},
    creditsWindow(active) { calls.push(active); },
    selectAudio() {}, selectSub() {},
    getMeta() { return Promise.resolve(meta); },
    onMeta(cb) { metaCbs.push(cb); return () => {}; },
    onLoading: unsub(), onKey: unsub(),
    getLoading() { return false; },
    getTime() { return lastTime; },
    onTime(cb) {
      timeCbs.push(cb);
      return () => { timeCbs = timeCbs.filter((x) => x !== cb); };
    },
    getTracks() { return null; },
    onTracks: unsub(),
    getChapters() { return lastChapters; },
    onChapters(cb) {
      chapterCbs.push(cb);
      return () => { chapterCbs = chapterCbs.filter((x) => x !== cb); };
    },
  };
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 650 },
  screen: { width: 1920, height: 1080 },
});

const freshPage = async (init) => {
  const page = await ctx.newPage();
  await page.addInitScript(mockBridge);
  if (init) await page.addInitScript(init);
  await page.goto(URL);
  await page.waitForSelector(".theater-overlay");
  return page;
};

const credits = (page) => page.evaluate(() => window.__credits.slice());

// ---- Scenario 1+2: AniSkip intervals (op must not fire, ed must) ----
{
  const page = await freshPage();
  await page.evaluate(() => {
    window.__setMeta({
      channelName: "T", title: "Ep", live: false,
      skips: [
        { type: "op", start: 60, end: 150 },
        { type: "ed", start: 1300, end: 1380 },
      ],
    });
  });
  await page.evaluate(() => window.__pushTime({ pos: 100, dur: 1440 }));
  await page.waitForTimeout(120);
  let c = await credits(page);
  check("inside an OP interval: no creditsWindow(true)", !c.includes(true), JSON.stringify(c));

  await page.evaluate(() => window.__pushTime({ pos: 1320, dur: 1440 }));
  await page.waitForTimeout(120);
  c = await credits(page);
  check("entering the ED interval fires creditsWindow(true)", c[c.length - 1] === true, JSON.stringify(c));

  await page.evaluate(() => window.__pushTime({ pos: 1390, dur: 1440 }));
  await page.waitForTimeout(120);
  c = await credits(page);
  check("leaving the ED interval fires creditsWindow(false)", c[c.length - 1] === false, JSON.stringify(c));
  await page.close();
}

// ---- Scenario 3: chapter fallback, position-gated ----
{
  const page = await freshPage();
  await page.evaluate(() => {
    window.__pushChapters([
      { title: "ED", start: 10 },      // early mislabel — must NOT fire
      { title: "Part 1", start: 100 },
      { title: "Credits", start: 1310 }, // > 60% of 1440 — fires
    ]);
  });
  await page.evaluate(() => window.__pushTime({ pos: 20, dur: 1440 }));
  await page.waitForTimeout(120);
  let c = await credits(page);
  check("early 'ED' chapter (first 60%): no fire", !c.includes(true), JSON.stringify(c));

  await page.evaluate(() => window.__pushTime({ pos: 1330, dur: 1440 }));
  await page.waitForTimeout(120);
  c = await credits(page);
  check("late 'Credits' chapter fires creditsWindow(true)", c[c.length - 1] === true, JSON.stringify(c));
  await page.close();
}

// ---- Scenario 4: skipBehavior=hidden still signals ----
{
  const page = await freshPage(() => {
    localStorage.setItem(
      "blammytv.skipBehavior",
      JSON.stringify({ v: 1, data: "hidden" }),
    );
  });
  await page.evaluate(() => {
    window.__setMeta({
      channelName: "T", title: "Ep", live: false,
      skips: [{ type: "ed", start: 1300, end: 1380 }],
    });
  });
  await page.evaluate(() => window.__pushTime({ pos: 1320, dur: 1440 }));
  await page.waitForTimeout(120);
  const c = await credits(page);
  const chip = await page.$(".skip-chip");
  check("skipBehavior=hidden: chip absent but signal fires", !chip && c[c.length - 1] === true, JSON.stringify(c));
  await page.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
