// E2E: popping a film or an episode out to VLC (plan 032, the page's half),
// with the native side (vlc.rs) stubbed at the IPC boundary and a fake Trakt
// in this process.
//
// What it holds:
//   - Settings → Playback → Pop Out Films and Shows In: MPV by default,
//     nothing stored until VLC is picked, and VLC stored when it is;
//   - a film or an episode popped out with VLC chosen calls `vlc_open` with the
//     source address, the title ("Show · S1 E4 · Episode" for an episode), no
//     User-Agent for a source that has none, and the position as `start`; it
//     does not call `popout_open`; the player closes and the toast says
//     "Playing in VLC";
//   - with MPV chosen the same button still calls `popout_open`, and a
//     LIVE pop-out calls it with VLC chosen too (live is not VLC's);
//   - `vlc-progress` events, sent the way Tauri sends them, move Continue
//     Watching's card and send Trakt a start, a pause and a stop; "gone" saves
//     the last position and ends the session; near the end an episode counts
//     as watched, and a film is told to MyAnimeList;
//   - VLC not installed: "VLC isn't installed." with Download VLC, which opens
//     videolan.org through open_external, and the player plays on; any other
//     refusal is shown in its own words.
//
// HOW. verify-player-prefs' stub (isTauri() is true, StreamScreen plays through
// useDirectOverlay) plus plugin:event|listen handlers to send `vlc-progress`
// through, and trakt_request forwarded to the fake Trakt (verify-trakt's way).
// Every call is logged in __tauriCalls.
//
//   node scripts/fake-aio.mjs     # :8084
//   node scripts/fake-panel.mjs   # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-vlc.mjs
import http from "node:http";
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const AIO = "http://localhost:8084/manifest.json";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// ---------------------------------------------------------------- fake Trakt
const traktCalls = [];
const trakt = http.createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    // The page forwards trakt_request with fetch, as verify-trakt does.
    if (rq.method === "OPTIONS") {
      rs.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE", "access-control-allow-headers": "content-type" });
      return rs.end();
    }
    const path = new URL(rq.url, "http://x").pathname;
    const body = raw ? JSON.parse(raw) : null;
    traktCalls.push({ method: rq.method, path, body });
    const send = (status, data) => {
      rs.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      rs.end(JSON.stringify(data));
    };
    const ep = /^\/shows\/(tt\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(path);
    if (ep) return send(200, { season: +ep[2], number: +ep[3], ids: { trakt: 5000 + +ep[3] } });
    const sc = /^\/scrobble\/(start|pause|stop)$/.exec(path);
    if (sc) return send(201, { action: sc[1] === "stop" ? "pause" : sc[1], progress: body.progress });
    // Nothing else: a sync finds a Trakt with nothing to say.
    return send(404, { error: "fake trakt has no " + path });
  });
});
await new Promise((r) => trakt.listen(0, "127.0.0.1", r));
const TRAKT_PORT = trakt.address().port;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

const DUR = 3000;
const FILM = { id: "tt100002", title: "Fake Movie Two", kind: "movie", at: Date.now(), posSec: 600, durSec: DUR };
const EPISODE = {
  id: "tt200001",
  title: "Fake Series One",
  kind: "series",
  at: Date.now(),
  episodeId: "tt200001:1:1",
  season: 1,
  episode: 1,
  epTitle: "S1E1 Title",
  label: "S1 · E1: S1E1 Title",
  posSec: 600,
  durSec: DUR,
};

/**
 * A page with the native side stubbed. `vlc` is what vlc_open answers: "ok",
 * "missing" (native's "vlc not installed") or a refusal's words. `store` goes
 * under blammytv.* ({ v: 1, data }). `live` adds an Xtream playlist from
 * fake-panel and starts on Live TV.
 */
async function open({ store = {}, watching = null, vlc = "ok", live = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ AIO, store, watching, vlc, live, DUR, port }) => {
      window.__tauriCalls = [];
      window.__pos = 600;
      window.__vlc = vlc;
      // Signed in to AIOStreams' Jellyfin side only when a check says so: its
      // sync would otherwise get a say in what the page does at launch.
      window.__aio = false;
      window.__presenting = !live;
      // MyAnimeList hears of a finished film by this event (watched.ts).
      window.__filmWatched = [];
      window.addEventListener("blammytv:film-watched", (e) => window.__filmWatched.push(e.detail.filmId));
      const listeners = {};
      let cb = 0;
      /** Send an event the way Tauri does: through the handler `listen` registered. */
      window.__emit = (event, payload) => {
        for (const h of listeners[event] ?? []) window["_" + h]({ event, id: 0, payload });
      };
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
          if (cmd === "plugin:event|listen") {
            (listeners[args.event] ??= []).push(args.handler);
            return Promise.resolve(++cb);
          }
          if (cmd === "vlc_open")
            return window.__vlc === "ok" ? Promise.resolve() : Promise.reject(window.__vlc === "missing" ? "vlc not installed" : window.__vlc);
          if (cmd === "trakt_status") return Promise.resolve({ configured: true, connected: true });
          if (cmd === "trakt_request")
            return fetch(`http://127.0.0.1:${port}${args.path}`, {
              method: args.method,
              headers: { "content-type": "application/json" },
              ...(args.body != null ? { body: args.body } : {}),
            }).then(async (r) => ({ status: r.status, body: await r.text(), retry_after: null, account_limit: null, upgrade_url: null }));
          if (cmd === "aiojf_status") return Promise.resolve(window.__aio ? { connected: true, userId: "u1", userName: "Sam" } : { connected: false });
          if (cmd === "aiojf_request") return Promise.resolve({ status: 204, body: "" });
          if (cmd === "mpv_status" && window.__presenting)
            return Promise.resolve(
              JSON.stringify({ pos: window.__pos, dur: DUR, presenting: true, ended: false, buffering: false, seekable: true, cacheDur: 0, dvrStart: 0, dvrEnd: 0, audio: [], subs: [], chapters: [] }),
            );
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const set = (k, v) => localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
      set("aiostreams", AIO);
      if (watching) set("watching", [watching]);
      set("startupTab", live ? "live" : "stream");
      if (live)
        set("playlists", [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }]);
      for (const [k, v] of Object.entries(store)) set(k, v);
    },
    { AIO, store, watching, vlc, live, DUR, port: TRAKT_PORT },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}
const calls = (page, cmd) => page.evaluate((cmd) => window.__tauriCalls.filter((c) => c[0] === cmd).map((c) => c[1]), cmd);
const stored = (page, key) => page.evaluate((key) => JSON.parse(localStorage.getItem(`blammytv.${key}`) ?? "null")?.data ?? null, key);
const waitFor = async (fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
/** The chrome idles out after a couple of seconds; a pointer over the picture raises it. */
const wake = async (page) => {
  await page.mouse.move(700, 420);
  await page.mouse.move(720, 440);
  await page.waitForTimeout(150);
};
const popOut = async (page) => {
  await wake(page);
  await page.getByRole("button", { name: "Pop Out", exact: true }).click({ timeout: 5000 });
};

/** `watching`'s card, playing from Continue Watching. */
async function playing(opts) {
  const { ctx, page } = await open(opts);
  const skip = page.getByRole("button", { name: /skip setup/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await goTo(page, "home");
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
  await page.waitForSelector(".theater-overlay", { timeout: 15_000 });
  await wake(page);
  return { ctx, page };
}
const barPct = (page) =>
  page.evaluate(() => {
    const i = document.querySelector(".continue-card .continue-card__progress i");
    return i ? Math.round(parseFloat(i.style.width)) : null;
  });

// ------------------------------------------------------------------- Settings
{
  const { ctx, page } = await open();
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Playback", exact: true }).click();
  await page.locator('[data-setting="popout-app"]').waitFor({ timeout: 5000 });
  const title = await page.locator('[data-setting="popout-app"] .customize-row__title').innerText();
  check("Settings → Playback has Pop Out Films and Shows In", title === "Pop Out Films and Shows In", title);
  const group = page.locator('.settings__body [role=group][aria-label="Pop out films and shows in"]');
  const names = await group.locator("button").allInnerTexts();
  const pressed = () => group.locator("button[aria-pressed=true]").allInnerTexts();
  check("  offering MPV and VLC", names.join() === "MPV,VLC", names.join());
  check("  MPV by default, and nothing stored", (await pressed()).join() === "MPV" && (await stored(page, "popoutApp")) === null, (await pressed()).join());
  await group.getByRole("button", { name: "VLC", exact: true }).click();
  check("  picking VLC keeps it", (await pressed()).join() === "VLC" && (await stored(page, "popoutApp")) === "vlc", JSON.stringify(await stored(page, "popoutApp")));
  await ctx.close();
}

// ----------------------------------------------------- an episode, to VLC and back
{
  const { ctx, page } = await playing({ store: { popoutApp: "vlc" }, watching: EPISODE });
  // Past the in-app player's own scrobbles: what follows is VLC's.
  await page.evaluate(() => {
    window.__aio = true;
    window.__tauriCalls.splice(0);
  });
  const mark = traktCalls.length;
  await popOut(page);
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "vlc_open"), null, { timeout: 8000 }).catch(() => {});
  const vlc = await calls(page, "vlc_open");
  check(
    "VLC chosen: a pop-out calls vlc_open with the address, the title and where it was",
    vlc.length === 1 && /^https?:\/\//.test(vlc[0].url) && vlc[0].start === 600,
    JSON.stringify(vlc.map((v) => ({ ...v, url: "…" }))),
  );
  check("  an episode is named Show · S1 E1 · Episode", /^Fake Series One · S1 E1 · \S/.test(vlc[0]?.title ?? ""), vlc[0]?.title);
  check("  a source with no User-Agent sends none", vlc.length === 1 && !("userAgent" in vlc[0]));
  check("  and not popout_open", (await calls(page, "popout_open")).length === 0);
  await page.locator(".vod-stage").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  check("  the in-app player closes", (await page.locator(".vod-stage").count()) === 0 && (await page.locator(".theater-overlay").count()) === 0);
  const toast = await page.locator(".live-toast").first().innerText({ timeout: 3000 }).catch(() => null);
  check("  and the toast says Playing in VLC", toast === "Playing in VLC", String(toast));
  check("  and Stream's rows are back, Continue Watching included", (await page.locator(".continue-card").count()) > 0);

  // ----- progress
  const emit = (pos, len, state) => page.evaluate((p) => window.__emit("vlc-progress", p), { pos, len, state });
  await emit(600, DUR, "playing");
  await emit(900, DUR, "playing");
  await page.waitForFunction(() => !!document.querySelector(".continue-card .continue-card__progress i"), null, { timeout: 5000 }).catch(() => {});
  await waitFor(async () => (await barPct(page)) === 30, 5000);
  check("fake vlc-progress moves the Continue Watching card (900 of 3000 is 30%)", (await barPct(page)) === 30, String(await barPct(page)));
  check("  and the saved position", (await stored(page, "watching"))?.[0]?.posSec === 900 && (await stored(page, "watching"))?.[0]?.durSec === DUR);

  // What Trakt heard once the in-app player had let go of it: that player's
  // own stop (20%) goes first, as it closes, and everything after is VLC's.
  const heard = () => {
    const all = traktCalls.slice(mark).filter((c) => c.path.startsWith("/scrobble/"));
    const i = all.findIndex((c) => c.path === "/scrobble/stop");
    return i < 0 ? [] : all.slice(i + 1).map((c) => ({ action: c.path.split("/")[2], progress: Math.round(c.body.progress) }));
  };
  const started = await waitFor(() => heard().some((h) => h.action === "start"), 15_000);
  check("Trakt hears a start from VLC", started, JSON.stringify(heard()));
  // AIOStreams' report is only seen to start: fake-aio's ids (tt200001) are not
  // ones it can pack (it needs seven digits), so it has nothing to send.
  check("  and AIOStreams' report is started for it too (it asks whether it is connected)", (await calls(page, "aiojf_status")).length > 0);

  // Paused at 900: the position stops moving, and a look later it is a pause.
  await emit(900, DUR, "paused");
  const paused = await waitFor(() => heard().some((h) => h.action === "pause"), 30_000);
  check("  a paused VLC is a pause, with where it is", paused && heard().find((h) => h.action === "pause").progress === 30, JSON.stringify(heard()));

  // Gone: the last position is saved and Trakt hears the stop.
  await emit(1500, DUR, "gone");
  await waitFor(() => heard().some((h) => h.action === "stop"), 10_000);
  const stops = heard().filter((h) => h.action === "stop");
  check("\"gone\" saves the last position", (await stored(page, "watching"))?.[0]?.posSec === 1500 && (await barPct(page)) === 50, `${(await stored(page, "watching"))?.[0]?.posSec} ${await barPct(page)}`);
  check("  and Trakt hears a stop with it (1500 of 3000)", stops.length === 1 && stops[0].progress === 50, JSON.stringify(heard()));
  // Nothing is followed any more: a stray report changes nothing.
  await emit(2000, DUR, "playing");
  await page.waitForTimeout(500);
  check("  after it a stray report changes nothing", (await stored(page, "watching"))?.[0]?.posSec === 1500);
  await ctx.close();
}

// ------------------------------------------------------------- a film, to VLC
{
  const { ctx, page } = await playing({ store: { popoutApp: "vlc" }, watching: FILM });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await popOut(page);
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "vlc_open"), null, { timeout: 8000 }).catch(() => {});
  const vlc = await calls(page, "vlc_open");
  check("a film is named by its title alone", vlc.length === 1 && vlc[0].title === "Fake Movie Two", JSON.stringify(vlc.map((v) => v.title)));
  const emit = (pos, len, state) => page.evaluate((p) => window.__emit("vlc-progress", p), { pos, len, state });
  await emit(2000, DUR, "playing");
  await page.waitForTimeout(300);
  check("a film short of 90% is not told as watched", (await page.evaluate(() => window.__filmWatched)).length === 0);
  await emit(2750, DUR, "playing");
  const told = await waitFor(async () => (await page.evaluate(() => window.__filmWatched)).includes("tt100002"), 5000);
  check("  and past it, it is (MyAnimeList hears of it, as from the player)", told);
  await emit(2760, DUR, "gone");
  await page.waitForTimeout(500);
  const w = (await stored(page, "watching"))?.[0];
  check("  a film saves its last position too", w?.posSec === 2760 && w?.durSec === DUR, JSON.stringify(w));
  await ctx.close();
}

// ------------------------------------------------- near the end, an episode
{
  const { ctx, page } = await playing({ store: { popoutApp: "vlc" }, watching: EPISODE });
  const mark = traktCalls.length;
  await popOut(page);
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "vlc_open"), null, { timeout: 8000 }).catch(() => {});
  const emit = (pos, len, state) => page.evaluate((p) => window.__emit("vlc-progress", p), { pos, len, state });
  await emit(2600, DUR, "playing");
  await page.waitForTimeout(300);
  check("an episode short of 90% is not ticked", !(((await stored(page, "watchedEpisodes")) ?? {}).tt200001 ?? []).includes("tt200001:1:1"));
  await emit(2800, DUR, "playing");
  const watched = await waitFor(async () => ((await stored(page, "watchedEpisodes")) ?? {}).tt200001?.includes("tt200001:1:1"), 5000);
  check("  and past it, it is ticked as watched", watched, JSON.stringify(await stored(page, "watchedEpisodes")));
  // Trakt's session is over at the same line: its stop goes out then, not at "gone".
  const stopped = await waitFor(() => traktCalls.slice(mark).some((c) => c.path === "/scrobble/stop" && c.body.progress >= 90), 15_000);
  check("  and Trakt hears the stop at that line, without waiting for VLC to close", stopped);
  await emit(2850, DUR, "gone");
  await page.waitForTimeout(1500);
  check("  VLC closing afterwards sends no second stop", traktCalls.slice(mark).filter((c) => c.path === "/scrobble/stop" && c.body.progress >= 90).length === 1);
  await ctx.close();
}

// ------------------------------------------------------------ not installed
{
  const { ctx, page } = await playing({ store: { popoutApp: "vlc" }, watching: EPISODE, vlc: "missing" });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await popOut(page);
  const note = page.locator(".vlc-note");
  await note.waitFor({ timeout: 8000 }).catch(() => {});
  const text = await note.innerText().catch(() => "");
  check("VLC not installed says so, with Download VLC", /VLC isn’t installed\./.test(text) && /Download VLC/.test(text), text.replace(/\n/g, " | "));
  check("  and the player plays on", (await page.locator(".theater-overlay").count()) === 1 && (await page.locator(".live-toast").count()) === 0 && (await calls(page, "popout_open")).length === 0);
  await note.getByRole("button", { name: "Download VLC", exact: true }).click();
  const ext = await calls(page, "open_external");
  check("  Download VLC opens videolan.org in the browser", ext.length === 1 && ext[0].url === "https://www.videolan.org/vlc/", JSON.stringify(ext));

  // Any other refusal: its own words, no download button.
  await page.evaluate(() => (window.__vlc = "only http and https urls can be played"));
  await note.getByRole("button", { name: "Dismiss", exact: true }).click();
  await popOut(page);
  const note2 = page.locator(".vlc-note");
  await note2.waitFor({ timeout: 8000 }).catch(() => {});
  const text2 = await note2.innerText().catch(() => "");
  check("another refusal shows its words", /Couldn’t open VLC: only http and https urls can be played\./.test(text2) && !/Download VLC/.test(text2), text2.replace(/\n/g, " | "));

  // The failure belongs to that play. Close the player and play the same
  // address again: nothing has been tried yet, so nothing is said.
  await wake(page);
  await page.locator(".theater-topleft button[aria-label=Back]").click();
  await page.locator(".theater-overlay").waitFor({ state: "detached", timeout: 8000 });
  await goTo(page, "home");
  await page.waitForTimeout(800);
  const opens = (await page.evaluate(() => window.__tauriCalls.filter((c) => c[0] === "inv_open").length));
  await page.locator(".continue-card").first().click({ timeout: 5000 });
  await page.waitForFunction((n) => window.__tauriCalls.filter((c) => c[0] === "inv_open").length > n, opens, { timeout: 25_000 });
  await page.waitForSelector(".theater-overlay", { timeout: 15_000 });
  await page.waitForTimeout(500);
  check("playing the same address again shows no VLC failure from before", (await page.locator(".vlc-note").count()) === 0, await page.locator(".vlc-note").innerText().catch(() => ""));
  await ctx.close();
}

// ---------------------------------------------------- MPV, which is what it did
{
  const { ctx, page } = await playing({ watching: EPISODE });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await popOut(page);
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "popout_open"), null, { timeout: 8000 }).catch(() => {});
  const pop = await calls(page, "popout_open");
  check("MPV chosen (the default): a pop-out calls popout_open and not vlc_open", pop.length === 1 && pop[0].live === false && (await calls(page, "vlc_open")).length === 0, JSON.stringify(pop.map((p) => ({ ...p, url: "…" }))));
  await ctx.close();
}

// ------------------------------------------------------------------ Live TV
{
  const { ctx, page } = await open({ live: true, store: { popoutApp: "vlc" } });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await page.locator('.guide__row:has(.guide__card[aria-label^="Fake ESPN"]) .guide__card').click();
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => (window.__presenting = true));
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await popOut(page);
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "popout_open"), null, { timeout: 8000 }).catch(() => {});
  const pop = await calls(page, "popout_open");
  check(
    "with VLC chosen a LIVE pop-out still calls popout_open (live: true) and not vlc_open",
    pop.length === 1 && pop[0].live === true && (await calls(page, "vlc_open")).length === 0,
    JSON.stringify(pop.map((p) => ({ ...p, url: "…" }))),
  );
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
trakt.close();
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
