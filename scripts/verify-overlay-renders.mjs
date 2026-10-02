// What the player chrome costs while a film sits there (ROADMAP M5, the
// overlay's re-renders). Drives the ?overlay=1 seam with a stubbed
// overlayApi whose onTime fires every 500ms, as useDirectOverlay's poll
// does (a new {pos, dur} object each time), and counts React commits
// through a devtools hook installed before React loads.
//
// Measured before v0.10.42: 2 commits a second playing AND paused, one per
// poll. The clock itself costs none (it writes its text straight to the
// node, since v0.9.0); what re-rendered a paused film was the poll handing
// over a new object with the same position.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const init = () => {
  window.__commits = 0;
  window.__fired = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onCommitFiberRoot() {
      window.__commits++;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    isDisabled: false,
  };
  const off = () => () => {};
  const timeCbs = new Set();
  window.__pos = 300;
  window.__playing = true;
  window.overlayApi = {
    close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {}, seekAbs() {}, setSpeed() {},
    expand() {}, collapse() {}, fullscreen() {}, exitFullscreen() {}, setMouseIgnore() {},
    getMeta: async () => ({ channelName: "Fake Movie", title: "Fake Movie", live: false }),
    onMeta: off,
    getLoading: () => false,
    onLoading: off,
    getTracks: () => null,
    onTracks: off,
    getTime: () => ({ pos: window.__pos, dur: 6000 }),
    onTime: (cb) => {
      timeCbs.add(cb);
      return () => timeCbs.delete(cb);
    },
    getChapters: () => [],
    onChapters: off,
  };
  setInterval(() => {
    if (window.__playing) window.__pos += 0.5;
    window.__fired++;
    const t = { pos: window.__pos, dur: 6000 };
    timeCbs.forEach((cb) => cb(t));
  }, 500);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(init);
await page.goto(`${APP}?overlay=1`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.mouse.move(800, 450);

/** Commits and polls over `ms`. */
const over = async (ms) => {
  const a = await page.evaluate(() => [window.__commits, window.__fired]);
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => [window.__commits, window.__fired]);
  return { commits: b[0] - a[0], polls: b[1] - a[1] };
};

const playing = await over(3000);
check(
  "playing, each poll moves the scrubber: about one commit per poll",
  playing.polls >= 5 && playing.commits >= playing.polls - 1,
  JSON.stringify(playing),
);

await page.evaluate(() => (window.__playing = false));
await page.waitForTimeout(700); // the last moving poll lands
const label = () => page.evaluate(() => document.querySelector(".theater-seek__labels span")?.textContent ?? "");
const before = await label();
const paused = await over(3000);
check(
  "paused, the polls go on and the chrome does not re-render for them",
  paused.polls >= 5 && paused.commits === 0,
  JSON.stringify(paused),
);
check("  and the clock still says where it stopped", before !== "" && (await label()) === before, JSON.stringify([before, await label()]));

await page.evaluate(() => (window.__playing = true));
const again = await over(2000);
check("playing again, it moves again", again.commits >= again.polls - 1 && again.polls >= 3, JSON.stringify(again));

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);
