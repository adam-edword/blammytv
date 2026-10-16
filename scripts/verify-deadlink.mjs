// E2E: a VOD that never opens fails fast, with the reason (v0.11.33), with the
// native side stubbed.
//
// A debrid 403, a 404, or an expired link that returns a web page used to sit
// on the loading screen for the watchdog's 40 seconds and then say "This
// source isn't responding. It's the stream, not you." mpv knows within ~50ms:
// it gives up on the file and falls back to idle, and stays there. The poll
// read that and ignored it while loading. Now native says how long ago it
// asked mpv for the file (mpv_status's sinceLoadMs), a VOD that is idle a
// second after its load, on two polls in a row, is called dead at once, and
// the card says what the link answered (mpv_open_error).
//
// HOW. The IPC boundary is stubbed (verify-upnext's pattern), so isTauri() is
// true and StreamScreen plays through useDirectOverlay. The stub is a small
// mpv: a mode per url says what mpv_status reports, and sinceLoadMs is read off
// the page's own clock from the moment of the last inv_open (as native stamps
// it at loadfile), so the stale idle BEFORE a load and the idle AFTER one are
// both things the stub can say. mpv_open_error answers from window.__answer.
//
// TIME. page.clock, PAUSED once the player is up, so the seconds are counted
// in exact fake time: a card is not asked at 999ms and is at 1100. The
// modes are set after the pause and the load is re-stamped at that moment, so
// every number below is measured from a known zero.
//
//   node scripts/fake-aio.mjs     # :8084
//   node scripts/fake-panel.mjs   # :8081 (the live check)
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-deadlink.mjs
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

const MOVIE = {
  id: "tt100001",
  title: "Fake Movie One",
  kind: "movie",
  posSec: 600,
  durSec: 5400,
  at: Date.now(),
};
const FIRST_LINE = "This source isn’t responding.";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** The page's side of the stub. Everything the harness changes later is a
 * window.__ global, set with page.evaluate once the clock is paused. */
function stub({ live, aio, movie, failover, playlists }) {
  window.__tauriCalls = [];
  // [[url pattern, mode]], first match wins; the default is "loading".
  window.__modes = [];
  window.__defaultMode = "loading";
  window.__loadedAt = null;
  window.__lastUrl = "";
  window.__answer = { status: 403, contentType: "text/html", failure: null };
  window.__hold = 0;
  window.__staleSpent = false;
  // Every time a dead card is put on the page. A card that appears and is
  // taken away again (the verdict, then a picture) leaves nothing in the DOM
  // to look at afterwards, and is exactly the failure a "never fast-fails"
  // check has to catch.
  window.__deadSeen = 0;
  new MutationObserver((muts) => {
    for (const m of muts)
      for (const n of m.addedNodes)
        if (n.nodeType === 1 && (n.matches(".tune__dead") || n.querySelector(".tune__dead"))) window.__deadSeen++;
  }).observe(document, { childList: true, subtree: true });
  // What mpv would say. `since` is native's clock: it starts at the loadfile
  // (inv_open, mpv_go_live) and is null before one and after inv_stop.
  const say = () => {
    const since = window.__loadedAt === null ? null : Date.now() - window.__loadedAt;
    const hit = window.__modes.find(([rx]) => new RegExp(rx).test(window.__lastUrl));
    const mode = hit ? hit[1] : window.__defaultMode;
    const s = since ?? 0;
    const playing = { pos: 5 + s / 1000, dur: 5400, presenting: true, ended: false };
    const idle = { pos: null, dur: null, presenting: false, ended: true };
    const wait = { pos: null, dur: null, presenting: false, ended: false };
    let st = wait;
    let reported = since;
    // A healthy file: opening, then a picture.
    if (mode === "healthy") st = s >= 100 ? playing : wait;
    // A link that failed to open: idle at once, and it stays there.
    else if (mode === "dead" || mode === "dead-nofield") st = idle;
    // The idle of the file BEFORE, read just after the new load (native's
    // clock says 50ms), until the new file's own picture.
    else if (mode === "stale") {
      st = s >= 400 ? playing : idle;
      if (s < 400) reported = 50;
    }
    // A server that takes its time: mpv is not idle while it waits.
    else if (mode === "slow") st = s >= 4000 ? playing : wait;
    // One stray idle read with an old stamp, then a normal open.
    else if (mode === "one-stale") {
      if (!window.__staleSpent && s >= 300) {
        window.__staleSpent = true;
        st = idle;
        reported = 5000;
      } else st = s >= 500 ? playing : wait;
    }
    const out = {
      ...st,
      buffering: false,
      seekable: true,
      cacheDur: 0,
      dvrStart: null,
      dvrEnd: null,
      audio: [],
      subs: [],
      chapters: [],
    };
    // An older native sends no such field.
    if (mode !== "dead-nofield") out.sinceLoadMs = reported;
    return JSON.stringify(out);
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
        window.__lastUrl = args.url;
        window.__loadedAt = Date.now();
      }
      if (cmd === "inv_stop") window.__loadedAt = null;
      if (cmd === "mpv_go_live") window.__loadedAt = Date.now();
      if (cmd === "mpv_status") return Promise.resolve(say());
      if (cmd === "mpv_open_error")
        return window.__answer === "reject"
          ? Promise.reject("unknown command")
          : Promise.resolve(window.__answer);
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
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
/** Fake milliseconds since the stub's last load. */
const sinceLoad = (page) => page.evaluate(() => Date.now() - window.__loadedAt);
const calls = (page, cmd) => page.evaluate((c) => window.__tauriCalls.filter((x) => x[0] === c).length, cmd);
const opens = (page) => page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").map((c) => c[1].url));
const cards = (page) => page.locator(".tune__dead").count();
const deadSeen = (page) => page.evaluate(() => window.__deadSeen);
/** Pump in small steps until the dead card is up; the fake ms since the load
 * when it was first seen, or null. */
async function cardAt(page, max, step = 50) {
  for (let t = 0; t <= max; t += step) {
    if ((await cards(page)) > 0) return sinceLoad(page);
    await pump(page, step);
  }
  return null;
}

/**
 * A film from its Continue Watching card, playing, the clock stopped. The
 * stub's mpv says "loading" (not idle, no picture) until the check sets modes,
 * so nothing happens in the real-time stretch before the pause; `modes` are set
 * after it, and the load is re-stamped to now, which is the zero every check
 * counts from.
 */
async function film({ modes = [], answer, failover = false, movie = MOVIE } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  await page.addInitScript(stub, { live: false, aio: AIO, movie, failover, playlists: null });
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
  await page.waitForFunction(() => window.__tauriCalls.filter((c) => c[0] === "mpv_status").length >= 3, null, { timeout: 15_000 });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 20);
  await page.evaluate(
    ({ modes, answer }) => {
      window.__modes = modes;
      if (answer !== undefined) window.__answer = answer;
      window.__loadedAt = Date.now();
    },
    { modes, answer },
  );
  return { ctx, page };
}

// ---- A link that never opened: the card, soon, with the reason ------------
{
  const { ctx, page } = await film({ modes: [[".", "dead"]] });
  // A second after the load is the floor: not before.
  await pump(page, 900);
  check("a dead link is not called dead before a second has passed since its load", (await cards(page)) === 0);
  const at = await cardAt(page, 1500);
  check("the dead card is up within 2s of the load", at !== null && at >= 1000 && at <= 2000, `${at}ms after the load`);
  const text = await page.locator(".tune__dead-msg").first().innerText().catch(() => null);
  check("  its first line is the one it always had", text === FIRST_LINE, JSON.stringify(text));
  await page.waitForFunction(() => !!document.querySelector(".tune__dead-why"), null, { timeout: 5000 }).catch(() => {});
  const why = await page.locator(".tune__dead-why").first().innerText().catch(() => null);
  check(
    "  and under it, what the link answered, from mpv_open_error",
    why === "The link answered 403 (Forbidden). Debrid links expire; try another source.",
    JSON.stringify(why),
  );
  check("  asked once", (await calls(page, "mpv_open_error")) === 1, String(await calls(page, "mpv_open_error")));
  const dom = await page.evaluate(() => {
    const msg = document.querySelector(".tune__dead-msg");
    const w = document.querySelector(".tune__dead-why");
    return { order: !!msg && !!w && !!(msg.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  check("  the reason sits after the first line", dom.order);
  check("  with Retry and the next source still on the card", (await page.locator(".tune__dead .tune__retry").count()) === 2);
  // VOD never reloads itself (each reload is a debrid request), and failover is
  // opt-in: this one is off, so the card is where it stops.
  await pump(page, 5000);
  check(
    "  and nothing reloads or fails over: one open, no go-live",
    (await opens(page)).length === 1 && (await calls(page, "mpv_go_live")) === 0 && (await cards(page)) === 1,
  );
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/deadlink-card.png` });
  await ctx.close();
}

// ---- The other answers ---------------------------------------------------
{
  const { ctx, page } = await film({
    modes: [[".", "dead"]],
    answer: { status: 200, contentType: "video/mp4", failure: null },
  });
  await cardAt(page, 2500);
  await pump(page, 500);
  check(
    "a link that answers like a video: the card keeps its one line, no claim",
    (await cards(page)) === 1 && (await page.locator(".tune__dead-why").count()) === 0 && (await calls(page, "mpv_open_error")) === 1,
  );
  await ctx.close();
}
{
  const { ctx, page } = await film({ modes: [[".", "dead"]], answer: "reject" });
  await cardAt(page, 2500);
  await pump(page, 500);
  const text = await page.locator(".tune__dead-msg").first().innerText().catch(() => null);
  check(
    "a native without mpv_open_error: today's line, quietly",
    (await cards(page)) === 1 && text === FIRST_LINE && (await page.locator(".tune__dead-why").count()) === 0,
  );
  await ctx.close();
}
{
  const { ctx, page } = await film({
    modes: [[".", "dead"]],
    answer: { status: null, contentType: null, failure: "timeout" },
  });
  await cardAt(page, 2500);
  await page.waitForFunction(() => !!document.querySelector(".tune__dead-why"), null, { timeout: 5000 }).catch(() => {});
  const why = await page.locator(".tune__dead-why").first().innerText().catch(() => null);
  check("a link that never answers the probe: the server didn’t answer", why === "The server didn’t answer.", JSON.stringify(why));
  await ctx.close();
}

// A Jellyfin stream the player was given the sign-in for, refused anyway: the
// card says the server wants a login, not that the stream is bad (plan 027).
{
  const { ctx, page } = await film({
    modes: [[".", "dead"]],
    answer: { status: 401, contentType: null, failure: null, signedInToJellyfin: true },
  });
  await cardAt(page, 2500);
  await page.waitForFunction(() => !!document.querySelector(".tune__dead-why"), null, { timeout: 5000 }).catch(() => {});
  const first = await page.locator(".tune__dead-msg").first().innerText().catch(() => null);
  const why = await page.locator(".tune__dead-why").first().innerText().catch(() => null);
  check(
    "a Jellyfin that refuses its own sign-in: the card says it wants a login, not that it is the stream",
    first === "Your Jellyfin wants a login for that file." && /^Your Jellyfin refused the file \(401\)\. .*sign in again/.test(why ?? ""),
    JSON.stringify({ first, why }),
  );
  await ctx.close();
}
{
  // The same status from a link the sign-in was not sent to is a link: nothing
  // about a login, and the card's own line.
  const { ctx, page } = await film({
    modes: [[".", "dead"]],
    answer: { status: 401, contentType: null, failure: null },
  });
  await cardAt(page, 2500);
  await page.waitForFunction(() => !!document.querySelector(".tune__dead-why"), null, { timeout: 5000 }).catch(() => {});
  const first = await page.locator(".tune__dead-msg").first().innerText().catch(() => null);
  const why = await page.locator(".tune__dead-why").first().innerText().catch(() => null);
  check("  and the same 401 from any other link is the link's: today's line and 'The link answered 401.'", first === FIRST_LINE && why === "The link answered 401.", JSON.stringify({ first, why }));
  await ctx.close();
}

// ---- With Auto Source Failover on, the next source plays, once -------------
{
  const { ctx, page } = await film({
    modes: [
      ["-4k", "dead"],
      ["-1080", "healthy"],
    ],
    failover: true,
  });
  await cardAt(page, 2500);
  await pump(page, 1500);
  const urls = await opens(page);
  check(
    "failover on: the dead source is followed by the next one",
    urls.length === 2 && /-4k/.test(urls[0]) && /-1080/.test(urls[1]),
    JSON.stringify(urls),
  );
  check("  which plays: no card, no loading screen", (await cards(page)) === 0 && (await page.locator(".tune, .vodload").count()) === 0);
  await pump(page, 10_000);
  check(
    "  once: nothing opens again, nothing reloads, and the reason is never asked for",
    (await opens(page)).length === 2 && (await calls(page, "mpv_go_live")) === 0 && (await calls(page, "mpv_open_error")) === 0,
    JSON.stringify(await opens(page)),
  );
  await ctx.close();
}

// ---- The entry follows the source that took over --------------------------
// Resume goes back to the file you were watching: after a failover that is the
// one it landed on, not the one the play began on (which is dead). The film with
// two releases sends file names, so both halves of the entry can be told apart.
{
  const TWO = { id: "tt500002", title: "Fake Movie Two Releases", kind: "movie", posSec: 600, durSec: 5400, at: Date.now() };
  const { ctx, page } = await film({
    movie: TWO,
    modes: [
      ["-4k", "dead"],
      ["-1080", "healthy"],
    ],
    failover: true,
  });
  const entryOf = () => page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.watching")).data[0]);
  const began = await entryOf();
  await cardAt(page, 2500);
  await pump(page, 1500);
  const urls = await opens(page);
  const landed = await entryOf();
  check(
    "the play began on the 4K file, and the entry said so",
    /-4k/.test(urls[0]) && began.fileName === "Two.Releases.2160p.WEB-DL.mkv" && began.bingeGroup === "fake|2160p|x265",
    JSON.stringify({ urls, began: [began.fileName, began.bingeGroup] }),
  );
  check(
    "  a failover to the 1080p file moves the entry's file name and binge group with it",
    urls.length === 2 && /-1080/.test(urls[1]) && landed.fileName === "Two.Releases.1080p.BluRay.mkv" && landed.bingeGroup === "fake|1080p",
    JSON.stringify({ urls, landed: [landed.fileName, landed.bingeGroup] }),
  );
  await ctx.close();
}

// ---- What must NOT fast-fail ---------------------------------------------
{
  const { ctx, page } = await film({ modes: [[".", "healthy"]] });
  await pump(page, 8000);
  check(
    "a healthy file never shows it, and nothing is asked",
    (await deadSeen(page)) === 0 && (await calls(page, "mpv_open_error")) === 0 && (await opens(page)).length === 1 && (await page.locator(".tune, .vodload").count()) === 0,
  );
  await ctx.close();
}
{
  // Idle for the first 400ms of the load, reading 50ms since it, then a picture:
  // the idle of the file before it, which reads the same as a dead link until
  // the loadfile lands. Several polls of it, so only the floor can refuse it.
  const { ctx, page } = await film({ modes: [[".", "stale"]] });
  await pump(page, 4000);
  check(
    "an idle read at 50ms since the load, poll after poll, is not a death, and it plays",
    (await deadSeen(page)) === 0 && (await page.locator(".tune, .vodload").count()) === 0 && (await opens(page)).length === 1,
    JSON.stringify({ cardsSeen: await deadSeen(page) }),
  );
  await ctx.close();
}
{
  // One idle read carrying an old stamp, then a normal open: a single poll.
  const { ctx, page } = await film({ modes: [[".", "one-stale"]] });
  await pump(page, 4000);
  check(
    "a single idle poll past the floor is not a death either, and it plays",
    (await deadSeen(page)) === 0 && (await page.locator(".tune, .vodload").count()) === 0 && (await opens(page)).length === 1,
    JSON.stringify({ cardsSeen: await deadSeen(page) }),
  );
  await ctx.close();
}
{
  // mpv waits on a slow server without going idle.
  const { ctx, page } = await film({ modes: [[".", "slow"]] });
  await pump(page, 3500);
  const waiting = (await cards(page)) === 0;
  await pump(page, 3000);
  check(
    "a server that takes 4s to answer is waited for, then plays",
    waiting && (await deadSeen(page)) === 0 && (await page.locator(".tune, .vodload").count()) === 0,
  );
  await ctx.close();
}

// ---- The 40 seconds, where nothing tells it sooner -------------------------
{
  // A native from before sinceLoadMs: idle reads as idle and no more.
  const { ctx, page } = await film({ modes: [[".", "dead-nofield"]] });
  await pump(page, 30_000);
  const early = await cards(page);
  await pump(page, 15_000);
  check(
    "no sinceLoadMs (an older native): the card waits the full window, as before",
    early === 0 && (await cards(page)) === 1,
    JSON.stringify({ at30s: early }),
  );
  await ctx.close();
}
{
  // The server that never answers: mpv is not idle, there is nothing to read.
  const { ctx, page } = await film({});
  await pump(page, 30_000);
  const early = await cards(page);
  await pump(page, 15_000);
  check("a server that never answers is still the watchdog's: the card at 40s", early === 0 && (await cards(page)) === 1, JSON.stringify({ at30s: early }));
  // The watchdog's card gets the same reason: the probe is asked of any VOD
  // card that stays.
  await page.waitForFunction(() => !!document.querySelector(".tune__dead-why"), null, { timeout: 5000 }).catch(() => {});
  check("  and the reason too, since the card is the same card", (await page.locator(".tune__dead-why").count()) === 1);
  await ctx.close();
}

// ---- Retry is not undone by the state it leaves behind ----------------------
{
  const { ctx, page } = await film({ modes: [[".", "dead"]] });
  await cardAt(page, 2500);
  await pump(page, 300);
  const asked = await calls(page, "mpv_open_error");
  // The fresh resolve takes 3s, and until it lands mpv is still reporting the
  // dead file: every one of those polls looks like a failed open.
  await page.evaluate(() => (window.__hold = 3000));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await pump(page, 2500);
  check(
    "Retry: while its fresh source is being found the dead card does not come back",
    (await cards(page)) === 0 && (await opens(page)).length === 1,
    JSON.stringify({ cards: await cards(page), opens: (await opens(page)).length }),
  );
  await until(page, () => window.__tauriCalls.filter((c) => c[0] === "inv_open").length >= 2, null, { max: 4000 });
  check("  the fresh source is opened (same link here, a new stream)", (await opens(page)).length === 2);
  const again = await cardAt(page, 2500);
  check(
    "  and if that one is dead too, it is called dead again, within 2s of its own load",
    again !== null && again >= 1000 && again <= 2000,
    `${again}ms after the load`,
  );
  await page.waitForFunction((n) => window.__tauriCalls.filter((c) => c[0] === "mpv_open_error").length > n, asked, { timeout: 5000 }).catch(() => {});
  check("  and asked why again", (await calls(page, "mpv_open_error")) === asked + 1, String(await calls(page, "mpv_open_error")));
  await ctx.close();
}

// ---- Live is unchanged ------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install();
  await page.addInitScript(stub, { live: true, aio: null, movie: null, failover: false, playlists: PLAYLISTS });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await page.locator(".guide__channel button").first().click();
  await page.locator(".mini-overlay .tune").waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => window.__tauriCalls.filter((c) => c[0] === "mpv_status").length >= 3, null, { timeout: 15_000 });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 20);
  // The same status a dead VOD link reads: idle, long after the load.
  await page.evaluate(() => {
    window.__modes = [[".", "dead"]];
    window.__loadedAt = Date.now();
  });
  await pump(page, 4000);
  check(
    "a live channel reading idle long after its load does not fast-fail: no card, no reason asked",
    (await deadSeen(page)) === 0 && (await calls(page, "mpv_open_error")) === 0,
    JSON.stringify({ cardsSeen: await deadSeen(page) }),
  );
  await pump(page, 10_000);
  check(
    "  its own recovery runs as ever: the silent reload at the first 10s",
    (await calls(page, "mpv_go_live")) >= 1 && (await cards(page)) === 0,
    JSON.stringify({ goLive: await calls(page, "mpv_go_live") }),
  );
  await pump(page, 25_000);
  check("  and the card only after its retries, with today’s line only", (await cards(page)) === 1 && (await page.locator(".tune__dead-why").count()) === 0 && (await calls(page, "mpv_open_error")) === 0);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
