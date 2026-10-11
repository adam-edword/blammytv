// E2E: the end-of-file Up Next card and its Autoplay setting (plan 025, P3a;
// v0.11.28), in StreamScreen with the native side stubbed.
//
// The card at the end of an episode used to count down from a fixed 10. It
// counts down from Settings → Playback → Autoplay Next Episode: Off, 5s, 10s
// or 20s, 10s unless changed, and Off is a card that waits.
//
// HOW. The IPC boundary is stubbed (verify-resolve-cancel's pattern), so
// isTauri() is true and StreamScreen plays through useDirectOverlay. The stub
// answers mpv_status from window.__pos / __dur / __ended: setting `ended` after
// a poll that reported the position near the end is what fires onEnded, and
// onEnded is what arms the card. http_get is the page's own fetch against
// fake-aio, so the next episode's request is a fact from the boundary: an
// http_get for its source list.
//
// TIME. page.clock, PAUSED once the episode is playing, so the countdown is
// counted in exact fake milliseconds and not raced against the real clock: a
// card at 5s is not asked at 4999, and is at 5000. Nothing runs while it is
// paused except what runFor/pump advances, so a test that waits for a
// condition does it by pumping.
//
// ALSO HERE: Skipping's automatic skip in the app, where a stream key exists
// (the overlay harness has one only by prop): Credits on Automatic, at a
// credits chapter, seeks mpv to the end of the file once, and the end-of-file
// card follows when mpv gets there.
//
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-upnext.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const AIO = "http://localhost:8084/manifest.json";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};

const DUR = 3000;
const entry = (s, e, posSec, durSec) => ({
  id: "tt200001",
  title: "Fake Series One",
  kind: "series",
  at: Date.now(),
  episodeId: `tt200001:${s}:${e}`,
  season: s,
  episode: e,
  epTitle: `S${s}E${e} Title`,
  label: `S${s} · E${e}: S${s}E${e} Title`,
  posSec,
  durSec,
});

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/**
 * Start playing episode 1 of fake-aio's Fake Series One from its Continue
 * Watching card, and stop the page's clock once it is on screen. `store` is
 * written under blammytv.*.
 */
async function playing(store = {}, { chapters = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  await page.addInitScript(
    ({ AIO, store, watching, chapters, DUR }) => {
      window.__tauriCalls = [];
      window.__pos = 600;
      window.__dur = DUR;
      window.__ended = false;
      window.__chapters = chapters;
      let cb = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => {
          const id = ++cb;
          window["_" + id] = f;
          return id;
        },
        convertFileSrc: (p) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        invoke: (cmd, args) => {
          window.__tauriCalls.push([cmd, args]);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.text());
          if (cmd === "mpv_seek_abs") {
            // As mpv would: the next poll reports where it went.
            window.__pos = args.pos;
            return Promise.resolve(undefined);
          }
          if (cmd === "mpv_status")
            return Promise.resolve(
              JSON.stringify({
                pos: window.__pos,
                dur: window.__dur,
                presenting: true,
                ended: window.__ended,
                buffering: false,
                seekable: true,
                audio: [],
                subs: [],
                chapters: window.__chapters,
              }),
            );
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: AIO }));
      localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: [watching] }));
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
    },
    { AIO, store, watching: entry(1, 1, 600, DUR), chapters, DUR },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: /^stream$/i }).first().click({ timeout: 15_000 });
  const card = page.locator(".continue-card").first();
  await card.waitFor({ timeout: 20_000 });
  // The card slides in; a click on a card still moving lands where it was.
  let lastBox = null;
  let still = 0;
  for (let i = 0; i < 25 && still < 2; i++) {
    const box = await card.boundingBox().catch(() => null);
    const key = box && `${Math.round(box.x)},${Math.round(box.y)}`;
    still = key && key === lastBox ? still + 1 : 0;
    lastBox = key;
    await page.waitForTimeout(80);
  }
  await card.click({ timeout: 5000 });
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_open"), null, { timeout: 25_000 });
  // On screen: mpv has reported a presented frame a few times over.
  await page.waitForFunction(() => window.__tauriCalls.filter((c) => c[0] === "mpv_status").length >= 3, null, { timeout: 15_000 });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 20);
  return { ctx, page };
}

/** Advance the page's clock, then let what that woke settle. */
const pump = async (page, ms) => {
  await page.clock.runFor(ms);
  await page.waitForTimeout(120);
};
/** Pump in steps until `fn` holds in the page (or give up). */
const pumpUntil = async (page, fn, arg, { step = 250, max = 30_000 } = {}) => {
  for (let t = 0; t <= max; t += step) {
    if (await page.evaluate(fn, arg)) return true;
    await pump(page, step);
  }
  return false;
};
const asked = (page, id) =>
  page.evaluate(
    (id) => window.__tauriCalls.filter((c) => c[0] === "http_get" && c[1].url.replace(/%3A/gi, ":").includes(`/stream/series/${id}`)).length,
    id,
  );
const opened = (page) => page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").map((c) => c[1].url));
const cardText = (page) => page.locator(".upnext__count").first().innerText({ timeout: 2000 }).catch(() => null);
const cardUp = (page) => page.locator(".upnext").count();

const STEP = 20;
/** Run episode 1 to its end: a poll near the end, then mpv's EOF. */
async function endEpisode(page, dur = DUR) {
  await page.evaluate((dur) => {
    window.__pos = dur - 5;
    window.__ended = false;
  }, dur);
  await pump(page, 700);
  await page.evaluate((dur) => {
    window.__pos = dur;
    window.__ended = true;
  }, dur);
  // In small steps: the card's countdown starts at the fake time it renders,
  // which can be anywhere inside the step that rendered it, so the step is
  // the margin every "not before N seconds" below is good to.
  await pumpUntil(page, () => !!document.querySelector(".upnext"), null, { step: STEP, max: 5000 });
}

// ====================================================================== 5s
{
  const { ctx, page } = await playing({ autoplayNext: 5 });
  await endEpisode(page);
  const text = await cardText(page);
  check("Autoplay 5s: the end-of-file card counts down from 5", text === "Playing in 5s", String(text));
  check("  and has not asked for the next episode", (await asked(page, "tt200001:1:2")) === 0);
  await pump(page, 5000 - 2 * STEP);
  const before = await asked(page, "tt200001:1:2");
  const textBefore = await cardText(page);
  check("  at 4.96s it still has not, and reads 1s", before === 0 && textBefore === "Playing in 1s", JSON.stringify({ before, textBefore }));
  await pump(page, 3 * STEP);
  const got = await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "http_get" && c[1].url.replace(/%3A/gi, ":").includes("/stream/series/tt200001:1:2")), null, { timeout: 5000 }).then(() => true, () => false);
  check("  at 5s the next episode is requested", got);
  const played = await pumpUntil(page, () => window.__tauriCalls.some((c) => c[0] === "inv_open" && c[1].url.includes("tt200001:1:2-")), null, { max: 15_000 });
  check("  and plays", played, JSON.stringify(await opened(page)));
  await ctx.close();
}

// ================================================================== default
{
  const { ctx, page } = await playing();
  await endEpisode(page);
  const text = await cardText(page);
  check("No setting (the default): the card counts down from 10, as it always did", text === "Playing in 10s", String(text));
  await pump(page, 10_000 - 2 * STEP);
  const before = await asked(page, "tt200001:1:2");
  check("  and has not asked at 9.96s", before === 0, String(before));
  await pump(page, 3 * STEP);
  const got = await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "http_get" && c[1].url.replace(/%3A/gi, ":").includes("/stream/series/tt200001:1:2")), null, { timeout: 5000 }).then(() => true, () => false);
  check("  and asks at 10s", got);
  await ctx.close();
}

// ======================================================================= Off
{
  const { ctx, page } = await playing({ autoplayNext: 0 });
  await endEpisode(page);
  const up = await cardUp(page);
  const count = await page.locator(".upnext__count").count();
  const text = await page.locator(".upnext").first().innerText();
  const buttons = await page.locator(".upnext button").allInnerTexts();
  check(
    "Autoplay Off: the card still shows at the end, with no \"Playing in\" line",
    up === 1 && count === 0 && !/Playing in/i.test(text) && /Up next/i.test(text) && /S1 · E2/.test(text),
    JSON.stringify({ up, count, text }),
  );
  check("  and offers Play now and Cancel as before", buttons.join() === "Play now,Cancel", JSON.stringify(buttons));
  await pump(page, 30_000);
  check(
    "  30 seconds later the next episode has not been requested, and the card waits",
    (await asked(page, "tt200001:1:2")) === 0 && (await cardUp(page)) === 1 && (await opened(page)).length === 1,
    JSON.stringify({ asked: await asked(page, "tt200001:1:2"), up: await cardUp(page) }),
  );
  await page.getByRole("button", { name: "Play now", exact: true }).click();
  const got = await pumpUntil(page, () => window.__tauriCalls.some((c) => c[0] === "http_get" && c[1].url.replace(/%3A/gi, ":").includes("/stream/series/tt200001:1:2")), null, { max: 5000 });
  check("  and Play now plays it", got);
  await ctx.close();
}
{
  const { ctx, page } = await playing({ autoplayNext: 0 });
  await endEpisode(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await pump(page, 500);
  check("  and Cancel closes the card without playing anything", (await cardUp(page)) === 0 && (await asked(page, "tt200001:1:2")) === 0);
  await ctx.close();
}

// ======================================================================= 20s
{
  const { ctx, page } = await playing({ autoplayNext: 20 });
  await endEpisode(page);
  const text = await cardText(page);
  await pump(page, 20_000 - 2 * STEP);
  const before = await asked(page, "tt200001:1:2");
  check("Autoplay 20s counts down from 20 and has not asked at 19.96s", text === "Playing in 20s" && before === 0, JSON.stringify({ text, before }));
  await ctx.close();
}

// ============================================== read when the card arms
{
  // The setting changes while the card is up: it applies to the NEXT card.
  const { ctx, page } = await playing({ autoplayNext: 10 });
  await endEpisode(page);
  await page.evaluate(() => localStorage.setItem("blammytv.autoplayNext", JSON.stringify({ v: 1, data: 0 })));
  await pump(page, 10_000);
  const got = await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "http_get" && c[1].url.replace(/%3A/gi, ":").includes("/stream/series/tt200001:1:2")), null, { timeout: 5000 }).then(() => true, () => false);
  check("a setting changed while a card is up does not touch that card: it still fires at 10s", got);
  await ctx.close();
}

// ============================================================ a binge
{
  // Episode 2 ends after episode 1's countdown FIRED: the state rests at 0
  // there, and the card for episode 3 must count from the setting and not
  // play at once (onEnded's re-arm).
  const { ctx, page } = await playing({ autoplayNext: 5 });
  await endEpisode(page);
  await pump(page, 5000);
  const second = await pumpUntil(page, () => window.__tauriCalls.some((c) => c[0] === "inv_open" && c[1].url.includes("tt200001:1:2-")), null, { max: 15_000 });
  await page.evaluate(() => {
    window.__pos = 100;
    window.__ended = false;
  });
  await pump(page, 2000);
  await endEpisode(page);
  const text = await cardText(page);
  check("a binge: episode 2 ends and its card is up at 5s for episode 3, not fired already", second && text === "Playing in 5s" && (await asked(page, "tt200001:1:3")) === 0, JSON.stringify({ second, text, asked3: await asked(page, "tt200001:1:3") }));
  await pump(page, 5000 - 2 * STEP);
  const before = await asked(page, "tt200001:1:3");
  await pump(page, 3 * STEP);
  const got = await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "http_get" && c[1].url.replace(/%3A/gi, ":").includes("/stream/series/tt200001:1:3")), null, { timeout: 5000 }).then(() => true, () => false);
  check("  and episode 3 is asked for at 5s, not before", before === 0 && got, JSON.stringify({ before, got }));
  await ctx.close();
}
{
  // Off, then a binge: the second card waits too.
  const { ctx, page } = await playing({ autoplayNext: 0 });
  await endEpisode(page);
  await page.getByRole("button", { name: "Play now", exact: true }).click();
  await pumpUntil(page, () => window.__tauriCalls.some((c) => c[0] === "inv_open" && c[1].url.includes("tt200001:1:2-")), null, { max: 15_000 });
  await page.evaluate(() => {
    window.__pos = 100;
    window.__ended = false;
  });
  await pump(page, 2000);
  await endEpisode(page);
  await pump(page, 30_000);
  check("Off through a binge: episode 3's card waits as well", (await cardUp(page)) === 1 && (await asked(page, "tt200001:1:3")) === 0 && (await page.locator(".upnext__count").count()) === 0);
  await ctx.close();
}

// =================================== Skipping's automatic skip, in the app
{
  const chapters = [
    { title: "Part A", start: 0 },
    { title: "Credits", start: 2700 },
  ];
  const { ctx, page } = await playing({ skipping: { intro: "button", recap: "button", credits: "auto", preview: "button", combine: false } }, { chapters });
  await page.evaluate(() => (window.__pos = 2000));
  await pump(page, 800);
  const early = await page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "mpv_seek_abs").length);
  await page.evaluate(() => (window.__pos = 2710));
  await pump(page, 800);
  await pump(page, 800);
  const seeks = await page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "mpv_seek_abs").map((c) => c[1].pos));
  check(
    "Credits on Automatic, in the app: a credits chapter seeks mpv to the end of the file, once",
    early === 0 && seeks.length === 1 && seeks[0] === DUR,
    JSON.stringify({ early, seeks }),
  );
  const chip = (await page.locator(".skip-chip").first().innerText().catch(() => "")).trim();
  check('  and "Skipped Credits" is in the chip\'s place', chip === "Skipped Credits", chip);
  // mpv gets there: EOF, and the card follows as it does after the chip.
  await page.evaluate(() => (window.__ended = true));
  const card = await pumpUntil(page, () => !!document.querySelector(".upnext"), null, { max: 5000 });
  check("  and when mpv reaches the end the end-of-file card follows", card);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
