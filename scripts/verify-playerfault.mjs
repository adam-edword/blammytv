// E2E: when the player itself cannot start, the tune card says so at once
// (v0.11.35), with the native side stubbed.
//
// The pinned libmpv imports vulkan-1.dll, so a PC with no Vulkan loader could
// not load it, inv_open rejected with libmpv's own message, and InvertedPlayer
// logged it and went on: with no player nothing read as failed, and the card
// waited out the tune watchdog (10s, then 40s on a VOD) before telling the
// user "It's the stream, not you". Now the failed open is reported the moment
// it happens: "The player couldn't start.", the native reason shortened
// under it, and a Retry that opens the player again.
//
// HOW. The IPC boundary is stubbed (verify-deadlink's pattern), so isTauri()
// is true and the real player path runs: InvertedPlayer asks inv_open, and the
// stub rejects it with the message mpv.rs load_libmpv builds when no
// libmpv-2.dll will load. With no player mpv_status reads empty, as native's
// does. A MutationObserver keeps every line the dead card has ever shown, so
// "never says it's the stream" is a look at the whole run and not at one
// moment, and a control run (a link that really is dead) proves that observer
// would have caught it.
//
// TIME. Real time until the card is up, so "within a second" is the real
// thing; then page.clock is PAUSED and the long waits (the watchdog's 10s,
// 40s, a failover) are counted in exact fake time.
//
//   node scripts/fake-aio.mjs     # :8084
//   node scripts/fake-panel.mjs   # :8081 (the live check)
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-playerfault.mjs
import { createRequire } from "node:module";
import { pauseSoon } from "./clock-pause.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const AIO = "http://localhost:8084/manifest.json";
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};

const MOVIE = {
  id: "tt100001",
  title: "Fake Movie One",
  kind: "movie",
  posSec: 600,
  durSec: 5400,
  at: Date.now(),
};
const FAULT_LINE = "The player couldn’t start.";
const STREAM_VOD = "This source isn’t responding.";
const STREAM_LIVE = "This channel isn’t responding.";
// What mpv.rs load_libmpv builds when no libmpv-2.dll will load. libloading's
// own text for the failure carries no code, so this is all the user is given.
const LIBMPV =
  "load libmpv-2.dll: LoadLibraryExW failed (also tried: " +
  "C:\\Users\\sam\\AppData\\Local\\BlammyTV\\libmpv-2.dll: LoadLibraryExW failed; " +
  "C:\\Users\\sam\\AppData\\Local\\BlammyTV\\resources\\libmpv-2.dll: LoadLibraryExW failed)";
const LIBMPV_SHORT = "load libmpv-2.dll: LoadLibraryExW failed";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** The page's side of the stub. Everything the harness changes later is a
 * window.__ global. */
function stub({ live, aio, movie, failover, playlists, libmpv, mode }) {
  window.__tauriCalls = [];
  // [{ url, at }] for every inv_open, and the message it is rejected with:
  // the ones queued in __rejects first, then __rejectAlways (null: it opens).
  window.__opens = [];
  window.__rejects = [];
  window.__rejectAlways = libmpv;
  // What mpv does once a file IS loaded: "healthy" plays, "dead" falls to idle,
  // "waiting" never shows anything and never gives up.
  window.__mode = mode;
  window.__loadedAt = null;
  window.__lastUrl = "";
  window.__hold = 0;
  // Every line the dead card ever showed, and when it first appeared.
  window.__texts = new Set();
  window.__cardAt = null;
  const look = () => {
    const card = document.querySelector(".tune__dead");
    if (card && window.__cardAt === null) window.__cardAt = performance.now();
    const msg = document.querySelector(".tune__dead-msg");
    if (msg) window.__texts.add(msg.textContent);
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
  // What native's mpv_status says. With no player (nothing opened) every
  // property reads empty: not presenting, not ended, no stamp.
  const say = () => {
    const since = window.__loadedAt === null ? null : Date.now() - window.__loadedAt;
    const s = since ?? 0;
    let st = { pos: null, dur: null, presenting: false, ended: false };
    if (since !== null && window.__mode === "healthy" && s >= 100) st = { pos: 5 + s / 1000, dur: 5400, presenting: true, ended: false };
    if (since !== null && window.__mode === "dead") st = { pos: null, dur: null, presenting: false, ended: true };
    return JSON.stringify({
      ...st,
      buffering: false,
      seekable: true,
      cacheDur: 0,
      dvrStart: null,
      dvrEnd: null,
      audio: [],
      subs: [],
      chapters: [],
      sinceLoadMs: since,
    });
  };
  // Both of a film's sources cached, so a failover has somewhere to go.
  const rewrite = (text) => {
    const body = JSON.parse(text);
    body.streams = (body.streams ?? []).map((x) =>
      x.url ? { ...x, streamData: { service: { cached: true } } } : x,
    );
    return JSON.stringify(body);
  };
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
      if (cmd === "http_get") {
        if (live) return fetch(args.url).then((r) => r.arrayBuffer());
        const go = () => fetch(args.url).then((r) => r.text());
        if (!/\/stream\//.test(args.url)) return go();
        return new Promise((res) => setTimeout(() => res(go().then(rewrite)), window.__hold));
      }
      if (cmd === "inv_open") {
        window.__opens.push({ url: args.url, at: performance.now() });
        window.__lastUrl = args.url;
        const why = window.__rejects.length ? window.__rejects.shift() : window.__rejectAlways;
        if (why) return Promise.reject(why);
        window.__loadedAt = Date.now();
        return Promise.resolve();
      }
      // A move of the video window that fails, with the player running.
      if (cmd === "inv_set_rect" && window.__rectFails) return Promise.reject("set_rect failed");
      if (cmd === "inv_stop") window.__loadedAt = null;
      if (cmd === "mpv_go_live") window.__loadedAt = Date.now();
      if (cmd === "mpv_status") return Promise.resolve(say());
      if (cmd === "mpv_open_error") return Promise.resolve({ status: 403, contentType: "text/html", failure: null });
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  if (failover) localStorage.setItem("blammytv.sourceFailover", JSON.stringify({ v: 1, data: true }));
  if (live) {
    localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: playlists }));
    localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
  } else {
    localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: aio }));
    localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: [movie] }));
  }
}

const PLAYLISTS = [
  {
    kind: "xtream",
    id: "t",
    name: "Test",
    enabled: true,
    server: "http://localhost:8081",
    username: "u",
    password: "p",
  },
];

/** Advance the page's clock, then let what that woke settle. */
const pump = async (page, ms) => {
  await page.clock.runFor(ms);
  await page.waitForTimeout(80);
};
/** Pump in steps until `fn` holds in the page (or give up). */
async function until(page, fn, arg, { step = 100, max = 5000 } = {}) {
  for (let t = 0; t <= max; t += step) {
    if (await page.evaluate(fn, arg)) return true;
    await pump(page, step);
  }
  return false;
}
/** A click that says whether it landed, instead of throwing: a harness that
 * throws at the first thing a regression breaks leaves the rest unchecked. */
const click = (loc) => loc.click({ timeout: 3000 }).then(() => true, () => false);
const calls = (page, cmd) => page.evaluate((c) => window.__tauriCalls.filter((x) => x[0] === c).length, cmd);
const opens = (page) => page.evaluate(() => window.__opens.map((o) => o.url));
const cards = (page) => page.locator(".tune__dead").count();
const texts = (page) => page.evaluate(() => [...window.__texts]);
/** Every line the dead card has ever shown was the player's: at least one, and
 * no other. (Not just "none of them is the stream's": that passes for a card
 * that never came.) */
const onlyThePlayers = async (page) => {
  const seen = await texts(page);
  return seen.length === 1 && seen[0] === FAULT_LINE;
};
const lineOf = (page) => page.locator(".tune__dead-msg").first().innerText().catch(() => null);
const whyOf = (page) => page.locator(".tune__dead-why").first().innerText().catch(() => null);
/** Real milliseconds from the first inv_open to the dead card, or null. */
async function cardWithin(page, max = 4000) {
  await page.waitForFunction(() => window.__cardAt !== null, null, { timeout: max }).catch(() => {});
  return page.evaluate(() => (window.__cardAt === null ? null : Math.round(window.__cardAt - window.__opens[0].at)));
}
/** Stop the page's clock where it is, so what follows is counted in fake time. */
async function freeze(page) {
  await pauseSoon(page);
}

/** A film from its Continue Watching card, playing, in real time. */
async function film({ failover = false, libmpv = LIBMPV, mode = "healthy" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  await page.addInitScript(stub, { live: false, aio: AIO, movie: MOVIE, failover, playlists: null, libmpv, mode });
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
  await page.waitForFunction(() => window.__opens.length > 0, null, { timeout: 25_000 });
  return { ctx, page };
}

/** A live channel from the Guide, playing in the mini player, in real time. */
async function channel({ libmpv = LIBMPV, mode = "healthy" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  await page.addInitScript(stub, { live: true, aio: null, movie: null, failover: false, playlists: PLAYLISTS, libmpv, mode });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await page.locator(".guide__channel button").first().click();
  await page.waitForFunction(() => window.__opens.length > 0, null, { timeout: 25_000 });
  return { ctx, page };
}

// ---- A VOD whose player cannot start --------------------------------------
{
  const { ctx, page } = await film();
  const ms = await cardWithin(page);
  check("VOD: the card is up within a second of the open", ms !== null && ms < 1000, `${ms}ms`);
  check("  its first line is the player's", (await lineOf(page)) === FAULT_LINE, JSON.stringify(await lineOf(page)));
  check(
    "  and under it the native reason, shortened: libmpv's first clause, none of its paths",
    (await whyOf(page)) === LIBMPV_SHORT,
    JSON.stringify(await whyOf(page)),
  );
  check(
    "  the reason sits after the first line",
    await page.evaluate(() => {
      const msg = document.querySelector(".tune__dead-msg");
      const w = document.querySelector(".tune__dead-why");
      return !!msg && !!w && !!(msg.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  );
  check(
    "  Retry is on it, and no next source: another source meets the same player",
    (await page.getByRole("button", { name: "Retry", exact: true }).count()) === 1 &&
      (await page.getByRole("button", { name: /next source/i }).count()) === 0,
  );
  check(
    "  and nothing says it is the stream: the only line the card has shown since the open is the player's",
    await onlyThePlayers(page),
    JSON.stringify(await texts(page)),
  );
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/playerfault-card.png` });

  // The watchdog's 40s, a reload, a failover: none of it is about this.
  await freeze(page);
  await pump(page, 45_000);
  check(
    "  45s on: the same card, still one open, no reload, no probe of the link",
    (await cards(page)) === 1 &&
      (await lineOf(page)) === FAULT_LINE &&
      (await opens(page)).length === 1 &&
      (await calls(page, "mpv_go_live")) === 0 &&
      (await calls(page, "mpv_open_error")) === 0,
    JSON.stringify({ opens: (await opens(page)).length, goLive: await calls(page, "mpv_go_live"), probe: await calls(page, "mpv_open_error") }),
  );
  // The host polls every 100ms while a tune is loading and every 500ms once
  // the card has called it dead (setTuneDead); this card is that call.
  const polls = await calls(page, "mpv_status");
  await pump(page, 5000);
  const during = (await calls(page, "mpv_status")) - polls;
  check("  and the host's status poll slowed down for it: about 10 reads in 5s, not 50", during > 0 && during <= 14, `${during} reads`);

  // Retry opens the player again. It fails again, for another reason.
  await page.evaluate(() => (window.__rejectAlways = "mpv_create failed"));
  const clicked = await click(page.getByRole("button", { name: "Retry", exact: true }));
  const second = clicked && (await until(page, () => window.__opens.length >= 2, null, { max: 3000 }));
  check("Retry: the player is asked to open again", second, `clicked ${clicked}, ${(await opens(page)).length} opens`);
  await pump(page, 500);
  check(
    "  it fails again: the card is back with the new reason, and not the old one",
    (await cards(page)) === 1 && (await lineOf(page)) === FAULT_LINE && (await whyOf(page)) === "mpv_create failed",
    JSON.stringify({ line: await lineOf(page), why: await whyOf(page) }),
  );

  // Then the cause is fixed (the file is back, a driver installed): it opens.
  await page.evaluate(() => (window.__rejectAlways = null));
  const clicked3 = await click(page.getByRole("button", { name: "Retry", exact: true }));
  const third = clicked3 && (await until(page, () => window.__opens.length >= 3, null, { max: 3000 }));
  check("Retry again, with the cause fixed: it opens", third && (await opens(page)).length === 3, `clicked ${clicked3}`);
  await pump(page, 3000);
  check(
    "  the card goes, and the film plays: no card, no loading screen",
    (await cards(page)) === 0 && (await page.locator(".tune, .vodload").count()) === 0,
    JSON.stringify({ cards: await cards(page), tune: await page.locator(".tune, .vodload").count() }),
  );
  check(
    "  and at no point in all of that did the card call it the stream: the only line it showed is the player's",
    await onlyThePlayers(page),
    JSON.stringify(await texts(page)),
  );
  await ctx.close();
}

// ---- With Auto Source Failover on, a player that cannot start is not a source that failed ----
{
  const { ctx, page } = await film({ failover: true });
  const ms = await cardWithin(page);
  check("VOD, failover on: the same card, within a second", ms !== null && ms < 1000 && (await lineOf(page)) === FAULT_LINE, `${ms}ms`);
  await freeze(page);
  await pump(page, 45_000);
  check(
    "  45s on it has not hopped to the next source: one open, the card still up, no probe",
    (await opens(page)).length === 1 && (await cards(page)) === 1 && (await calls(page, "mpv_open_error")) === 0,
    JSON.stringify(await opens(page)),
  );
  await ctx.close();
}

// ---- Live is the same card ------------------------------------------------
{
  const { ctx, page } = await channel();
  const ms = await cardWithin(page);
  check("Live: the card is up within a second of the open", ms !== null && ms < 1000, `${ms}ms`);
  check("  its first line is the player's", (await lineOf(page)) === FAULT_LINE, JSON.stringify(await lineOf(page)));
  check("  with the reason under it", (await whyOf(page)) === LIBMPV_SHORT, JSON.stringify(await whyOf(page)));
  check("  and Retry", (await page.locator(".tune__dead .tune__retry").count()) === 1);
  await freeze(page);
  await pump(page, 25_000);
  check(
    "  25s on: the watchdog's two silent reloads did not run (there is no player to reload), and the card is the same",
    (await calls(page, "mpv_go_live")) === 0 && (await cards(page)) === 1 && (await lineOf(page)) === FAULT_LINE,
    JSON.stringify({ goLive: await calls(page, "mpv_go_live"), line: await lineOf(page) }),
  );
  check(
    "  and nothing said it was the channel: the only line the card showed is the player's",
    await onlyThePlayers(page),
    JSON.stringify(await texts(page)),
  );
  // Retry on live opens the player again, too.
  await page.evaluate(() => (window.__rejectAlways = null));
  await click(page.locator(".tune__dead .tune__retry"));
  await until(page, () => window.__opens.length >= 2, null, { max: 3000 });
  await pump(page, 3000);
  check(
    "  Retry, with the cause fixed: the player opens again and the card goes",
    (await opens(page)).length === 2 && (await cards(page)) === 0,
    JSON.stringify({ opens: (await opens(page)).length, cards: await cards(page) }),
  );
  await ctx.close();
}

// ---- A move that fails is not a player that could not start ----------------
{
  // The player opened and is waiting on a slow stream. The window then moves
  // (a resize) and native refuses the move: InvertedPlayer's catch sees that
  // too, and only the OPEN may say the player could not start.
  const { ctx, page } = await film({ libmpv: null, mode: "waiting" });
  await page.evaluate(() => (window.__rectFails = true));
  await page.setViewportSize({ width: 1200, height: 760 });
  const moved = await page
    .waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "inv_set_rect"), null, { timeout: 5000 })
    .then(() => true, () => false);
  await page.waitForTimeout(600);
  check(
    "a refused move of the window, with the player open: no player card, nothing dead on the screen",
    moved && (await cards(page)) === 0 && (await texts(page)).length === 0,
    JSON.stringify({ moved, cards: await cards(page), texts: await texts(page) }),
  );
  await ctx.close();
}

// ---- The control: a link that really is dead still says it is the stream ----
// Without it, "never says it's the stream" above would pass for an observer
// that could not see the line at all.
{
  const { ctx, page } = await film({ libmpv: null, mode: "dead" });
  await cardWithin(page, 8000);
  check(
    "control: the player opens and the link is dead: the stream's own line, no player line",
    (await lineOf(page)) === STREAM_VOD && !(await texts(page)).includes(FAULT_LINE),
    JSON.stringify(await texts(page)),
  );
  check("  with Retry and the next source, as before", (await page.locator(".tune__dead .tune__retry").count()) === 2);
  await ctx.close();
}
{
  const { ctx, page } = await channel({ libmpv: null, mode: "waiting" });
  await freeze(page);
  await pump(page, 36_000);
  check(
    "control, live: the player opens and nothing ever shows: the channel's own line after the watchdog, no player line",
    (await lineOf(page)) === STREAM_LIVE && !(await texts(page)).includes(FAULT_LINE),
    JSON.stringify(await texts(page)),
  );
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
