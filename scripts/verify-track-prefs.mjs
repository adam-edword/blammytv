// Headless verify: VOD playback continuity — the audio/subtitle language you
// picked once being re-applied to the NEXT episode.
//
// WHY THIS EXISTS SEPARATELY from verify-overlay-tracks. That harness drives
// the track MENUS (what they list, what they check, what they call). This one
// drives the apply effect underneath them, which is a different subject and
// had no coverage at all: it only runs under `vod` + a `playbackKey`, and the
// `?overlay=1` entry passed neither, so `vod` was false and the whole effect
// was dead code as far as any harness was concerned.
//
// The bug it was written for: v0.9.31 made "Play now" stop the old episode
// before resolving the new one, which turned the episode boundary from a prop
// change into an UNMOUNT. TheaterOverlay seeded its track state synchronously
// from the bridge cache at mount, and that cache still held the finished
// episode's list — so the once-per-key guard was spent matching remembered
// languages against dead track ids, and the real list was skipped when it
// landed a poll later. Subs and audio reset at every episode boundary.
//
// Run:
//   pnpm --filter @blammytv/app build
//   pnpm --filter @blammytv/app preview            # serves :4173
//   npm i playwright-core   (anywhere, e.g. the session scratchpad)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-track-prefs.mjs

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/?overlay=1";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/** The episode that just finished. DIFFERENT IDS from the next one, which is
 * the whole point: a selection made against these ids is provably the stale
 * list being acted on, not a coincidence. */
const PREV = {
  audio: [
    { id: 1, label: "English", lang: "eng", selected: true },
    { id: 2, label: "Español", lang: "spa", selected: false },
  ],
  subs: [
    { id: 3, label: "English", lang: "eng", selected: true },
    { id: 4, label: "Español", lang: "spa", selected: false },
  ],
};
const NEXT = {
  audio: [
    { id: 11, label: "English", lang: "eng", selected: true },
    { id: 12, label: "Español", lang: "spa", selected: false },
  ],
  subs: [
    { id: 13, label: "English", lang: "eng", selected: true },
    { id: 14, label: "Español", lang: "spa", selected: false },
  ],
};

// The bridge mock. Same contract as verify-overlay-tracks (getTracks is
// SYNCHRONOUS, on* return unsubscribers), plus two behaviours of the real
// bridge that this subject lives or dies on:
//
//   1. A push before mount is what getTracks() hands the seed.
//   2. A select BLANKS THE POLL'S DEDUPE KEY, so mpv's own answer re-pushes
//      within one tick whether or not it changed (useDirectOverlay does this
//      deliberately — a refusal leaves the flags identical, and without the
//      blanking nothing would ever contradict the request).
//
// window.__mpvMode picks what that answer is. "obey" selects the track that
// was asked for, which is the happy path. "refuse" pushes the list back
// UNCHANGED, which is what mpv really does when it declines a selection: no
// error, no return value, just the same flags as before.
const mockBridge = () => {
  const calls = [];
  let tracksCbs = [];
  let lastTracks = null;
  window.__calls = calls;
  window.__pushTracks = (t) => {
    lastTracks = t;
    tracksCbs.slice().forEach((cb) => cb(t));
  };
  // The poll confirming, one tick later. Async on purpose: a synchronous
  // re-push inside the select would re-enter React mid-render.
  const answer = (kind, id) =>
    setTimeout(() => {
      if (!lastTracks) return;
      const list = kind === "audio" ? "audio" : "subs";
      const next =
        window.__mpvMode === "refuse"
          ? { ...lastTracks }
          : {
              ...lastTracks,
              [list]: lastTracks[list].map((t) => ({
                ...t,
                selected: String(t.id) === String(id),
              })),
            };
      window.__pushTracks(next);
    }, 30);
  const unsub = () => () => {};
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {},
    seekTo() {}, setSpeed() {}, expand() {}, collapse() {}, fullscreen() {},
    exitFullscreen() {}, popout() {}, panel() {}, toggleFavorite() {},
    goLive() {}, setMouseIgnore() {},
    selectAudio(id) { calls.push(["selectAudio", String(id)]); answer("audio", id); },
    selectSub(id) { calls.push(["selectSub", String(id)]); answer("sub", id); },
    getMeta() {
      return Promise.resolve({ channelName: "Test Show", title: "S1 · E2" });
    },
    onMeta: unsub, onLoading: unsub, onKey: unsub, onTime: unsub,
    getLoading() { return false; },
    getTime() { return null; },
    getTracks() { return lastTracks; },
    onTracks(cb) {
      tracksCbs.push(cb);
      return () => { tracksCbs = tracksCbs.filter((x) => x !== cb); };
    },
  };
};

/**
 * Seed the prefs store. The envelope shape is lib/storage's.
 *
 * BOTH KEYS, ALWAYS. The pages share one browser context, so localStorage
 * carries over — and the page that proves an explicit pick is written to the
 * per-show store leaves a real record behind. Seeding only the global left
 * that record armed, and a later page asserting "nothing is selected" got
 * six audio selections from a preference it never set. An empty seed has to
 * mean empty.
 */
const seedPrefs = ([global, byShow]) => {
  localStorage.setItem(
    "blammytv.playbackPrefs",
    JSON.stringify({ v: 1, data: global }),
  );
  localStorage.setItem(
    "blammytv.playbackPrefsByShow",
    JSON.stringify({ v: 1, data: byShow ?? { order: [], byId: {} } }),
  );
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
// Same geometry as verify-overlay-tracks: theater, not mini, not fullscreen.
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 650 },
  screen: { width: 1920, height: 1080 },
});

const openOverlay = async (prefs, props, cached, mode = "obey") => {
  const page = await ctx.newPage();
  await page.addInitScript((m) => { window.__mpvMode = m; }, mode);
  await page.addInitScript(mockBridge);
  await page.addInitScript(seedPrefs, prefs);
  await page.addInitScript((p) => { window.__overlayProps = p; }, props);
  // The finished episode's list, sitting in the bridge cache exactly as a
  // real one does when the next episode mounts a fresh overlay.
  if (cached) await page.addInitScript((t) => window.__pushTracks(t), cached);
  await page.goto(URL);
  await page.waitForSelector(".theater-overlay");
  return page;
};

/** Poll for a call to land: the apply effect runs off a React state update,
 * so it is never synchronous with the push. Returns the call list. */
const waitCalls = (page, n) =>
  page
    .waitForFunction((want) => window.__calls.length >= want, n, {
      timeout: 3000,
    })
    .then(() => page.evaluate(() => window.__calls))
    .catch(() => page.evaluate(() => window.__calls));

// ---- Page 1: the episode boundary ----
const page1 = await openOverlay(
  [{ audioLang: "spa", subLang: "spa" }],
  { vod: true, playbackKey: "ep2", showId: "tt-show" },
  PREV,
);

// The check the bug fails. Nothing about the finished episode's track list
// tells us anything about this file, and matching against it is worse than
// useless: it burns the one shot the effect gets per stream.
await page1.waitForTimeout(300);
const stale = await page1.evaluate(() => window.__calls);
check(
  "a fresh mount ignores the previous episode's cached track list",
  stale.length === 0,
  stale.length ? JSON.stringify(stale) : "",
);

// The real list arrives a poll later. THIS is what the remembered languages
// have to be applied to.
await page1.evaluate((t) => window.__pushTracks(t), NEXT);
const applied = await waitCalls(page1, 2);
check(
  "the new episode's tracks get the remembered audio language",
  applied.some((c) => JSON.stringify(c) === '["selectAudio","12"]'),
  JSON.stringify(applied),
);
check(
  "the new episode's tracks get the remembered subtitle language",
  applied.some((c) => JSON.stringify(c) === '["selectSub","14"]'),
  JSON.stringify(applied),
);
check("nothing else was selected", applied.length === 2, JSON.stringify(applied));

// The menus agree, so the user sees what mpv was told.
await page1.mouse.move(550, 300);
await page1.mouse.move(560, 310);
await page1.waitForSelector('[aria-label="Audio track"]:not(:disabled)');
await page1.click('[aria-label="Audio track"]');
const audioItems = page1.locator('.track-menu [role="menuitemradio"]');
check(
  "the audio menu shows Español checked",
  (await audioItems.nth(1).getAttribute("aria-checked")) === "true",
);
await page1.keyboard.press("Escape");
await page1.click('[aria-label="Subtitles"]');
const subItems = page1.locator('.track-menu [role="menuitemradio"]');
// Off, English, Español.
check(
  "the subtitle menu shows Español checked",
  (await subItems.nth(2).getAttribute("aria-checked")) === "true",
);
await page1.close();

// ---- Page 2: "off" is a choice, and it survives the boundary too ----
const page2 = await openOverlay(
  [{ subLang: "off" }],
  { vod: true, playbackKey: "ep2", showId: "tt-show" },
  PREV,
);
await page2.evaluate((t) => window.__pushTracks(t), NEXT);
const off = await waitCalls(page2, 1);
check(
  "subtitles set to off stay off on the next episode",
  JSON.stringify(off) === '[["selectSub","no"]]',
  JSON.stringify(off),
);
await page2.close();

// ---- Page 3: no preference stored, nothing touched ----
// The effect must not have an opinion of its own. Before any explicit pick,
// whatever the file selected by default is what plays.
const page3 = await openOverlay(
  [{}],
  { vod: true, playbackKey: "ep2", showId: "tt-show" },
  PREV,
);
await page3.evaluate((t) => window.__pushTracks(t), NEXT);
await page3.waitForTimeout(400);
const untouched = await page3.evaluate(() => window.__calls);
check(
  "no stored preference selects nothing",
  untouched.length === 0,
  JSON.stringify(untouched),
);
await page3.close();

// ---- Page 4: the remember half — an explicit pick is written to both stores ----
const page4 = await openOverlay(
  [{}],
  { vod: true, playbackKey: "ep1", showId: "tt-show" },
  null,
);
await page4.evaluate((t) => window.__pushTracks(t), NEXT);
await page4.mouse.move(550, 300);
await page4.mouse.move(560, 310);
await page4.waitForSelector('[aria-label="Audio track"]:not(:disabled)');
await page4.click('[aria-label="Audio track"]');
await page4.locator('.track-menu [role="menuitemradio"]').nth(1).click();
const stored = await page4.evaluate(() => ({
  global: JSON.parse(localStorage.getItem("blammytv.playbackPrefs") ?? "null"),
  byShow: JSON.parse(
    localStorage.getItem("blammytv.playbackPrefsByShow") ?? "null",
  ),
}));
check(
  "picking a track writes the global answer",
  stored.global?.data?.audioLang === "spa",
  JSON.stringify(stored.global),
);
check(
  "picking a track pins it to the show",
  stored.byShow?.data?.byId?.["tt-show"]?.audioLang === "spa",
  JSON.stringify(stored.byShow),
);
await page4.close();

// ---- Page 5: mpv refusing the selection ---------------------------------
// The one that Adam's captions kept dying on. mpv declines a selection more
// often than the old code assumed — a stale id, an instance still loading —
// and it declines SILENTLY. The guard used to be spent on the request, and
// the local list was optimistically flipped to show it selected, so the
// refusal was invisible and the dimension was finished for the whole file.
{
  const page = await openOverlay(
    [{ subLang: "spa" }],
    { vod: true, playbackKey: "ep2", showId: "tt-show" },
    null,
    "refuse",
  );
  await page.evaluate((t) => window.__pushTracks(t), NEXT);
  // Each refusal re-pushes, which re-runs the apply, which asks again — so
  // this drives itself and then has to STOP on its own.
  await page.waitForTimeout(2000);
  const subCalls = await page.evaluate(() =>
    window.__calls.filter((c) => c[0] === "selectSub"),
  );
  check(
    "a refused subtitle selection is asked for again",
    subCalls.length > 1,
    `${subCalls.length} attempts`,
  );
  check(
    "…and every attempt names the right track",
    subCalls.every((c) => c[1] === "14"),
    JSON.stringify(subCalls),
  );
  // APPLY_TRIES in TheaterOverlay. The number is not the point; giving up is.
  check(
    "…and it gives up rather than asking for the whole film",
    subCalls.length === 6,
    `${subCalls.length} attempts`,
  );
  await page.close();
}

// ---- Page 6: a language the file does not carry -------------------------
// No match is SETTLED, not failed. Retrying cannot conjure a German track,
// and a retry loop here would be the same bug in the other direction.
{
  const page = await openOverlay(
    [{ subLang: "de" }],
    { vod: true, playbackKey: "ep2", showId: "tt-show" },
    null,
    "refuse",
  );
  await page.evaluate((t) => window.__pushTracks(t), NEXT);
  await page.waitForTimeout(1500);
  const calls = await page.evaluate(() => window.__calls);
  check(
    "a language the file does not carry is never asked for",
    calls.length === 0,
    JSON.stringify(calls),
  );
  await page.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed`,
);
process.exit(fails.length ? 1 : 0);
