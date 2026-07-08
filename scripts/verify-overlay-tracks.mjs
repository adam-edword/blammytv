// Headless verify: TheaterOverlay's audio/subtitle track menus against a
// mocked overlayApi bridge (same pattern as the tune-watchdog verify). The
// mock mimics comp.rs's OVERLAY_BRIDGE_JS exactly: getTracks is SYNCHRONOUS,
// on* return unsubscribe fns, selectAudio/selectSub String() their id.
//
// Run:
//   pnpm --filter @blammytv/app build
//   pnpm --filter @blammytv/app preview            # serves :4173
//   npm i playwright-core   (anywhere, e.g. the session scratchpad)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-overlay-tracks.mjs
//
// PW_FROM lets the script resolve playwright-core from outside the repo so it
// never lands in our package.json. Chromium: /opt/pw-browsers/chromium.

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/?overlay=1";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const TRACKS = {
  audio: [
    { id: 1, label: "English", lang: "eng", selected: true },
    { id: 2, label: "Español", lang: "spa", selected: false },
  ],
  subs: [{ id: 3, label: "English CC", lang: "eng", selected: false }],
};

const mockBridge = () => {
  const calls = [];
  let tracksCbs = [];
  let lastTracks = null;
  window.__calls = calls;
  window.__pushTracks = (t) => {
    lastTracks = t;
    tracksCbs.slice().forEach((cb) => cb(t));
  };
  const unsub = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {},
    seekTo() {}, setSpeed() {}, expand() {}, collapse() {}, fullscreen() {},
    exitFullscreen() {}, popout() {}, panel() {}, toggleFavorite() {},
    goLive() {}, setMouseIgnore() {},
    selectAudio(id) { calls.push(["selectAudio", String(id)]); },
    selectSub(id) { calls.push(["selectSub", String(id)]); },
    getMeta() { return Promise.resolve({ channelName: "Test One", title: "Now" }); },
    onMeta: unsub(), onLoading: unsub(), onKey: unsub(), onTime: unsub(),
    getLoading() { return false; },
    getTime() { return null; },
    getTracks() { return lastTracks; },
    onTracks(cb) {
      tracksCbs.push(cb);
      return () => { tracksCbs = tracksCbs.filter((x) => x !== cb); };
    },
  };
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
// 1100x650 inside a 1920 screen = THEATER (not mini: >450 tall; not fs).
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 650 },
  screen: { width: 1920, height: 1080 },
});

// ---- Page 1: live push after mount (the onTracks path) ----
const page = await ctx.newPage();
await page.addInitScript(mockBridge);
await page.goto(URL);
await page.waitForSelector(".theater-overlay");

// Buttons are always rendered; they gray out (disabled) with nothing to choose.
check(
  "no tracks yet → both buttons disabled",
  (await page.locator(".theater-tracks button:disabled").count()) === 2,
);

await page.evaluate((t) => window.__pushTracks(t), TRACKS);
await page.mouse.move(550, 300); // wake the chrome
await page.mouse.move(560, 310);
await page.waitForSelector('[aria-label="Audio track"]:not(:disabled)');
check(
  "tracks push → audio + CC buttons enabled",
  (await page.locator('[aria-label="Audio track"]:not(:disabled)').count()) ===
    1 &&
    (await page.locator('[aria-label="Subtitles"]:not(:disabled)').count()) ===
      1,
);

// Audio menu: entries + current selection.
await page.click('[aria-label="Audio track"]');
const items = page.locator('.track-menu [role="menuitemradio"]');
check(
  "audio menu lists 2 tracks, English checked",
  (await items.count()) === 2 &&
    (await items.nth(0).getAttribute("aria-checked")) === "true" &&
    (await items.nth(0).textContent()) === "English",
);

// Switch audio → bridge call + optimistic checkmark + menu closes.
await items.nth(1).click();
const calls1 = await page.evaluate(() => window.__calls);
check(
  "click Español → selectAudio('2'), menu closes",
  JSON.stringify(calls1.at(-1)) === '["selectAudio","2"]' &&
    (await page.locator(".track-menu").count()) === 0,
);
await page.click('[aria-label="Audio track"]');
check(
  "reopen → Español checked (optimistic)",
  (await items.nth(1).getAttribute("aria-checked")) === "true" &&
    (await items.nth(0).getAttribute("aria-checked")) === "false",
);
await page.keyboard.press("Escape");
check("Escape closes the menu", (await page.locator(".track-menu").count()) === 0);

// Subs menu: Off entry checked when nothing selected; toggling both ways.
await page.click('[aria-label="Subtitles"]');
const subItems = page.locator('.track-menu [role="menuitemradio"]');
check(
  "subs menu: Off + 1 track, Off checked",
  (await subItems.count()) === 2 &&
    (await subItems.nth(0).textContent()) === "Off" &&
    (await subItems.nth(0).getAttribute("aria-checked")) === "true",
);
await subItems.nth(1).click();
await page.click('[aria-label="Subtitles"]');
const afterOn = await page.evaluate(() => window.__calls);
check(
  "enable CC → selectSub('3'), CC checked",
  afterOn.some((c) => JSON.stringify(c) === '["selectSub","3"]') &&
    (await subItems.nth(1).getAttribute("aria-checked")) === "true",
);
await subItems.nth(0).click();
const afterOff = await page.evaluate(() => window.__calls);
check(
  "Off → selectSub('no')",
  JSON.stringify(afterOff.at(-1)) === '["selectSub","no"]',
);

// A fresh Rust push (the 500ms poll confirming) overrides local state.
await page.evaluate(
  (t) => window.__pushTracks(t),
  {
    audio: [
      { id: 1, label: "English", lang: "eng", selected: false },
      { id: 2, label: "Español", lang: "spa", selected: true },
    ],
    subs: TRACKS.subs,
  },
);
await page.click('[aria-label="Audio track"]');
check(
  "Rust re-push confirms selection",
  (await items.nth(1).getAttribute("aria-checked")) === "true",
);

// Single audio track + no subs → no buttons at all.
await page.evaluate(() =>
  window.__pushTracks({
    audio: [{ id: 1, label: "English", lang: "eng", selected: true }],
    subs: [],
  }),
);
// Poll: the push lands via React state, so the flip isn't synchronous.
const grayed = await page
  .waitForFunction(
    () =>
      document.querySelectorAll(".theater-tracks button:disabled").length === 2,
    null,
    { timeout: 3000 },
  )
  .then(() => true)
  .catch(() => false);
check("1 audio / 0 subs → both buttons grayed out", grayed);
await page.close();

// ---- Page 2: tracks cached in the bridge BEFORE React mounts (the getTracks
// seed — this is what survives the push landing before the app loads). ----
const page2 = await ctx.newPage();
await page2.addInitScript(mockBridge);
await page2.addInitScript((t) => window.__pushTracks(t), TRACKS);
await page2.goto(URL);
await page2.waitForSelector(".theater-overlay");
check(
  "pre-mount cached tracks seed via sync getTracks()",
  (await page2.locator(".theater-tracks button:not(:disabled)").count()) === 2,
);
await page2.close();

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
