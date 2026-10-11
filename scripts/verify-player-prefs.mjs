// E2E: the player's settings (plan 025, P3b; v0.11.29): Audio Channels,
// Subtitle Size, Pop-out, and the subtitle delay, with the native side stubbed.
//
// Settings → Playback has a Player group: Audio Channels (Automatic, Stereo,
// 5.1, 7.1), Subtitle Size (Small, Normal, Large, Larger) and Pop-out (a size
// and a corner). Audio Channels and Subtitle Size are mpv's, and native holds
// them (`mpv_prefs`); the pop-out's two ride each `popout_open`. The delay is
// not a setting: z and x in the player move it a tenth of a second, per file,
// and the subtitle menu has a Delay line.
//
//   - Settings: the rows, their defaults, and what a click stores. Their place:
//     with and without an AIOStreams (the Player group is for Live TV too);
//   - native, at launch and on every change: `mpv_prefs` once with the stored
//     values, then again with both on each change. A native build that has no
//     such command (the stub rejects it) leaves no page error and Settings
//     still works; a plain browser never asks;
//   - the pop-out: `popout_open` carries the size and corner as they stand;
//   - the delay, in the player: x, x, z call `mpv_sub_delay` with +0.1, +0.1,
//     -0.1 and the picture says what the stub returned, not what was asked;
//     Shift+Z is x (mpv's own); with no subtitle track on the keys do nothing;
//     the subtitle menu's Delay line shows the value and its buttons call the
//     command, Reset calls the reset; live is the same; a native build with no
//     delay command is quiet and the line goes.
//
// HOW. The IPC boundary is stubbed (verify-upnext's pattern): isTauri() is
// true and StreamScreen plays through useDirectOverlay. The stub answers
// mpv_status from window.__subs, and records every call in window.__tauriCalls.
// Live is the bare chrome (`?overlay=1`) against a mocked overlayApi.
//
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-player-prefs.mjs
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
const SUBS_ON = [{ id: 3, label: "English", lang: "eng", selected: true }];
const SUBS_OFF = [{ id: 3, label: "English", lang: "eng", selected: false }];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/**
 * A page with the native side stubbed. `store` is written under blammytv.*
 * (as { v: 1, data }), `tauri` false is a plain browser tab (no IPC at all).
 * `native` says what the stub answers: `prefs` false rejects mpv_prefs and
 * `delay` false rejects the two delay commands, as a build from before
 * v0.11.29 does (the command is not found); `delay0` is the delay mpv
 * already has when the film opens, which is what lets a check tell the
 * picture showing the stub's answer from the picture adding up its own.
 * `subs` is what mpv_status says the file carries.
 */
async function open({ store = {}, tauri = true, native = {}, subs = SUBS_ON, path = "", viewport = { width: 1440, height: 900 }, watching = null } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ AIO, store, tauri, native, subs, DUR, watching }) => {
      window.__tauriCalls = [];
      // A rejection nobody caught is not a page error to Playwright, so it is
      // written down here and the checks that reject on purpose read it.
      window.__unhandled = [];
      window.addEventListener("unhandledrejection", (e) => window.__unhandled.push(String(e.reason)));
      window.__pos = 600;
      window.__subs = subs;
      window.__delay = native.delay0 ?? 0;
      if (tauri) {
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
            if (cmd === "mpv_prefs") return native.prefs === false ? Promise.reject(`command ${cmd} not found`) : Promise.resolve(undefined);
            if (cmd === "mpv_sub_delay") {
              if (native.delay === false) return Promise.reject(`command ${cmd} not found`);
              window.__delay = Math.round((window.__delay + args.delta) * 10) / 10;
              return Promise.resolve(window.__delay);
            }
            if (cmd === "mpv_sub_delay_reset") {
              if (native.delay === false) return Promise.reject(`command ${cmd} not found`);
              window.__delay = 0;
              return Promise.resolve(0);
            }
            if (cmd === "mpv_status")
              return Promise.resolve(
                JSON.stringify({
                  pos: window.__pos,
                  dur: DUR,
                  presenting: true,
                  ended: false,
                  buffering: false,
                  seekable: true,
                  audio: [],
                  subs: window.__subs,
                  chapters: [],
                }),
              );
            return Promise.resolve(undefined);
          },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      }
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      // Once: a reload in a check must see what the check left.
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const set = (k, v) => localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
      if (AIO) set("aiostreams", AIO);
      if (watching) set("watching", [watching]);
      set("startupTab", "stream");
      for (const [k, v] of Object.entries(store)) set(k, v);
    },
    { AIO: store.aiostreams === null ? null : AIO, store: Object.fromEntries(Object.entries(store).filter(([k]) => k !== "aiostreams")), tauri, native, subs, DUR, watching },
  );
  await page.goto(APP + path, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}
const calls = (page, cmd) => page.evaluate((cmd) => window.__tauriCalls.filter((c) => c[0] === cmd).map((c) => c[1]), cmd);
const unhandled = (page) => page.evaluate(() => window.__unhandled);
const stored = (page, key) => page.evaluate((key) => JSON.parse(localStorage.getItem(`blammytv.${key}`) ?? "null"), key);

// ------------------------------------------------------------------- Settings
const gear = (page) => page.getByRole("button", { name: "Settings", exact: true }).first();
async function openPlayback(page) {
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await gear(page).click();
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Playback", exact: true }).click();
  await page.waitForTimeout(500);
}
const seg = (page, name) => page.getByRole("group", { name, exact: true });
const pressed = (page, name) =>
  page.evaluate((name) => {
    const g = document.querySelector(`.settings__body [role=group][aria-label='${name}']`);
    return [...(g?.querySelectorAll("button") ?? [])].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  }, name);
const titles = (page) => page.locator(".settings__body .customize-row__title").allInnerTexts();

{
  const { ctx, page } = await open();
  await openPlayback(page);
  const rows = await titles(page);
  check(
    "Playback: Stream's rows, then the Player group: Audio Channels, Subtitle Size, Pop-out",
    JSON.stringify(rows) ===
      JSON.stringify(["One-Click Play Movies", "Auto Source Failover", "Autoplay Next Episode", "Up Next Card", "Skipping", "Preferred Language", "Audio Channels", "Subtitle Size", "Pop-out"]),
    JSON.stringify(rows),
  );
  const groups = await page.locator(".settings__body .settings__group").allInnerTexts();
  check("  under two eyebrows, Stream and Player, with no Live TV / Stream pill", JSON.stringify(groups.map((g) => g.toLowerCase())) === JSON.stringify(["stream", "player"]) && (await page.locator(".settings__body .customize-rail").count()) === 0, JSON.stringify(groups));
  const names = await page.evaluate(() => {
    const g = (n) => [...document.querySelectorAll(`.settings__body [role=group][aria-label='${n}'] button`)].map((b) => b.textContent).join();
    return { audio: g("Audio channels"), sub: g("Subtitle size"), size: g("Pop-out size"), corner: g("Pop-out corner") };
  });
  check(
    "  with their choices: Automatic, Stereo, 5.1, 7.1; Small, Normal, Large, Larger; Small, Medium, Large; Centre and the four corners",
    names.audio === "Automatic,Stereo,5.1,7.1" && names.sub === "Small,Normal,Large,Larger" && names.size === "Small,Medium,Large" && names.corner === "Centre,Top left,Top right,Bottom left,Bottom right",
    JSON.stringify(names),
  );
  const dflt = {
    audio: await pressed(page, "Audio channels"),
    sub: await pressed(page, "Subtitle size"),
    size: await pressed(page, "Pop-out size"),
    corner: await pressed(page, "Pop-out corner"),
  };
  check(
    "  and on a fresh profile: Automatic, Normal, Large and Centre",
    dflt.audio.join() === "Automatic" && dflt.sub.join() === "Normal" && dflt.size.join() === "Large" && dflt.corner.join() === "Centre",
    JSON.stringify(dflt),
  );
  const nothing = await page.evaluate(() => ["audioChannels", "subtitleSize", "popoutSize", "popoutCorner"].map((k) => localStorage.getItem(`blammytv.${k}`)));
  check("  and nothing is stored until one is chosen", nothing.every((v) => v === null), JSON.stringify(nothing));

  await seg(page, "Audio channels").getByRole("button", { name: "7.1", exact: true }).click();
  await seg(page, "Subtitle size").getByRole("button", { name: "Larger", exact: true }).click();
  await seg(page, "Pop-out size").getByRole("button", { name: "Small", exact: true }).click();
  await seg(page, "Pop-out corner").getByRole("button", { name: "Bottom left", exact: true }).click();
  await page.waitForTimeout(200);
  const keep = {
    audio: await stored(page, "audioChannels"),
    sub: await stored(page, "subtitleSize"),
    size: await stored(page, "popoutSize"),
    corner: await stored(page, "popoutCorner"),
    now: [(await pressed(page, "Audio channels")).join(), (await pressed(page, "Subtitle size")).join(), (await pressed(page, "Pop-out size")).join(), (await pressed(page, "Pop-out corner")).join()],
  };
  check(
    "a click stores its choice, versioned, and the control shows it",
    JSON.stringify([keep.audio, keep.sub, keep.size, keep.corner]) ===
      JSON.stringify([{ v: 1, data: "7.1" }, { v: 1, data: "larger" }, { v: 1, data: "small" }, { v: 1, data: "bottom-left" }]) &&
      keep.now.join("|") === "7.1|Larger|Small|Bottom left",
    JSON.stringify(keep),
  );
  // A reload: what was chosen is what Settings shows.
  await page.reload({ waitUntil: "domcontentloaded" });
  await openPlayback(page);
  const again = [(await pressed(page, "Audio channels")).join(), (await pressed(page, "Subtitle size")).join(), (await pressed(page, "Pop-out size")).join(), (await pressed(page, "Pop-out corner")).join()];
  check("  and after a restart too", again.join("|") === "7.1|Larger|Small|Bottom left", again.join("|"));
  await ctx.close();
}

// A value this build does not offer is the default, not a blank control.
{
  const { ctx, page } = await open({ store: { audioChannels: "quadraphonic", subtitleSize: 9, popoutSize: "huge", popoutCorner: "middle" } });
  await openPlayback(page);
  const got = [(await pressed(page, "Audio channels")).join(), (await pressed(page, "Subtitle size")).join(), (await pressed(page, "Pop-out size")).join(), (await pressed(page, "Pop-out corner")).join()];
  check("stored values nobody offers read as the defaults", got.join("|") === "Automatic|Normal|Large|Centre", got.join("|"));
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "mpv_prefs"), null, { timeout: 5000 }).catch(() => {});
  const sent = await calls(page, "mpv_prefs");
  check("  and native is told the defaults, never the junk", sent.length === 1 && sent[0].audioChannels === "auto-safe" && sent[0].subScale === 1, JSON.stringify(sent));
  await ctx.close();
}

// The Player group is Live TV's as well: with no AIOStreams it is all there is.
{
  const { ctx, page } = await open({ store: { aiostreams: null } });
  await openPlayback(page);
  const rows = await titles(page);
  const note = (await page.locator(".settings__body").innerText()).replace(/\n/g, " ");
  const ids = await page.evaluate(() => [...document.querySelectorAll(".settings__body [data-setting]")].map((e) => e.dataset.setting));
  check(
    "with no AIOStreams the Player group is still there, and Stream's rows are not",
    JSON.stringify(rows) === JSON.stringify(["Audio Channels", "Subtitle Size", "Pop-out"]) && JSON.stringify(ids) === JSON.stringify(["audio-channels", "subtitle-size", "popout"]),
    JSON.stringify({ rows, ids }),
  );
  check("  under the sign-in note for the rest", /Sign in to your AIOStreams in Settings/.test(note), note.slice(0, 120));
  await ctx.close();
}

// Nothing runs off the card, at a wide window and a narrow one.
for (const [label, width] of [["wide", 1440], ["narrow", 700]]) {
  const { ctx, page } = await open({ viewport: { width, height: 900 } });
  await openPlayback(page);
  await page.locator("[data-setting='popout']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const body = document.querySelector(".settings__body");
    const b = body.getBoundingClientRect();
    const out = [];
    for (const id of ["audio-channels", "subtitle-size", "popout"])
      for (const g of document.querySelectorAll(`[data-setting='${id}'] [role=group]`)) {
        const r = g.getBoundingClientRect();
        out.push(r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && g.scrollWidth <= g.clientWidth + 1);
      }
    return { all: out.every(Boolean), n: out.length, noScroll: body.scrollWidth <= body.clientWidth + 1 };
  });
  check(`at a ${label} card every choice sits inside it, side by side`, fit.n === 4 && fit.all && fit.noScroll, JSON.stringify(fit));
  await ctx.close();
}

// ------------------------------------------------------------ to the native side
{
  const { ctx, page } = await open({ store: { audioChannels: "5.1", subtitleSize: "large" } });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "mpv_prefs"), null, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);
  const first = await calls(page, "mpv_prefs");
  check(
    "at launch mpv_prefs is called once, with the stored values (5.1, and Large's 1.25)",
    first.length === 1 && first[0].audioChannels === "5.1" && first[0].subScale === 1.25,
    JSON.stringify(first),
  );
  await openPlayback(page);
  await seg(page, "Audio channels").getByRole("button", { name: "Stereo", exact: true }).click();
  await page.waitForTimeout(200);
  const afterAudio = await calls(page, "mpv_prefs");
  check(
    "Audio Channels to Stereo calls it with stereo, and the subtitle size as it stands",
    afterAudio.length === 2 && afterAudio[1].audioChannels === "stereo" && afterAudio[1].subScale === 1.25,
    JSON.stringify(afterAudio.slice(1)),
  );
  await seg(page, "Subtitle size").getByRole("button", { name: "Larger", exact: true }).click();
  await page.waitForTimeout(200);
  await seg(page, "Subtitle size").getByRole("button", { name: "Large", exact: true }).click();
  await page.waitForTimeout(200);
  const afterSub = await calls(page, "mpv_prefs");
  check(
    "Subtitle Size to Larger calls it with 1.5, and to Large with 1.25, each with stereo",
    afterSub.length === 4 && afterSub[2].subScale === 1.5 && afterSub[3].subScale === 1.25 && afterSub.slice(2).every((c) => c.audioChannels === "stereo"),
    JSON.stringify(afterSub.slice(2)),
  );
  await seg(page, "Audio channels").getByRole("button", { name: "Automatic", exact: true }).click();
  await page.waitForTimeout(200);
  const last = (await calls(page, "mpv_prefs")).at(-1);
  check("Automatic is mpv's own word for it, auto-safe", last?.audioChannels === "auto-safe", JSON.stringify(last));
  // Choosing what is already chosen is nothing new for mpv.
  const n = (await calls(page, "mpv_prefs")).length;
  await seg(page, "Audio channels").getByRole("button", { name: "Automatic", exact: true }).click();
  await page.waitForTimeout(200);
  check("  and choosing it again is no new call", (await calls(page, "mpv_prefs")).length === n, String(n));
  // The pop-out's two are not mpv_prefs: they ride popout_open.
  await seg(page, "Pop-out size").getByRole("button", { name: "Small", exact: true }).click();
  await seg(page, "Pop-out corner").getByRole("button", { name: "Top right", exact: true }).click();
  await page.waitForTimeout(200);
  check("the pop-out's size and corner do not go through mpv_prefs", (await calls(page, "mpv_prefs")).length === n, String(n));
  await ctx.close();
}

// An older native: no such command. The page does not mind.
{
  const errorsBefore = errors.length;
  const { ctx, page } = await open({ native: { prefs: false } });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "mpv_prefs"), null, { timeout: 10_000 }).catch(() => {});
  await openPlayback(page);
  await seg(page, "Audio channels").getByRole("button", { name: "Stereo", exact: true }).click();
  await seg(page, "Subtitle size").getByRole("button", { name: "Small", exact: true }).click();
  await page.waitForTimeout(400);
  const asked = (await calls(page, "mpv_prefs")).length;
  check("a native build that rejects mpv_prefs is asked, and Settings still works: both choices are kept and shown", asked >= 2 && (await stored(page, "audioChannels"))?.data === "stereo" && (await stored(page, "subtitleSize"))?.data === "small" && (await pressed(page, "Audio channels")).join() === "Stereo" && (await pressed(page, "Subtitle size")).join() === "Small", JSON.stringify({ asked }));
  const un = await unhandled(page);
  check("  and no page error, and no rejection left uncaught", errors.length === errorsBefore && un.length === 0, JSON.stringify({ errors: errors.slice(errorsBefore, errorsBefore + 2), un }));
  await ctx.close();
}

// A plain browser tab has no native side to tell.
{
  const errorsBefore = errors.length;
  const { ctx, page } = await open({ tauri: false });
  await openPlayback(page);
  await seg(page, "Audio channels").getByRole("button", { name: "Stereo", exact: true }).click();
  await page.waitForTimeout(300);
  check(
    "in a plain browser tab Settings works with no native side, and no page error",
    (await stored(page, "audioChannels"))?.data === "stereo" && (await pressed(page, "Audio channels")).join() === "Stereo" && errors.length === errorsBefore,
    errors.slice(errorsBefore, errorsBefore + 2).join(" | "),
  );
  await ctx.close();
}

// ------------------------------------------------------------- playing, in app
const entry = (posSec) => ({
  id: "tt200001",
  title: "Fake Series One",
  kind: "series",
  at: Date.now(),
  episodeId: "tt200001:1:1",
  season: 1,
  episode: 1,
  epTitle: "S1E1 Title",
  label: "S1 · E1: S1E1 Title",
  posSec,
  durSec: DUR,
});

/** Episode 1 of fake-aio's Fake Series One, playing from its Continue Watching card. */
async function playing(opts = {}) {
  const { ctx, page } = await open({ ...opts, watching: entry(600) });
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
  // The track list lands a poll later: the Subtitles button is live.
  await page.waitForSelector(".theater-overlay", { timeout: 15_000 });
  await wake(page);
  return { ctx, page };
}
/** The chrome idles out after a couple of seconds; a pointer over the picture raises it. */
const wake = async (page) => {
  await page.mouse.move(700, 420);
  await page.mouse.move(720, 440);
  await page.waitForTimeout(150);
};
const toast = (page) => page.locator(".sub-delay-toast").first().innerText({ timeout: 800 }).catch(() => null);
const delays = (page) => calls(page, "mpv_sub_delay").then((a) => a.map((x) => x.delta));
const lineGroup = (page) => page.locator(".track-menu__delay");

{
  const { ctx, page } = await playing({ store: { popoutSize: "small", popoutCorner: "bottom-right" } });
  await page.evaluate(() => window.__tauriCalls.splice(0));

  // The pop-out: both ride popout_open.
  await wake(page);
  await page.getByRole("button", { name: "Pop out", exact: true }).click({ timeout: 5000 });
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "popout_open"), null, { timeout: 5000 }).catch(() => {});
  const pop = await calls(page, "popout_open");
  check(
    "Pop out sends popout_open the size and corner as set (small, bottom-right), with live:false for a film",
    pop.length === 1 && pop[0].size === "small" && pop[0].corner === "bottom-right" && pop[0].live === false && /^https?:/.test(pop[0].url),
    JSON.stringify(pop.map((p) => ({ ...p, url: "…" }))),
  );
  await ctx.close();
}
{
  const { ctx, page } = await playing();
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await wake(page);
  await page.getByRole("button", { name: "Pop out", exact: true }).click({ timeout: 5000 });
  await page.waitForFunction(() => window.__tauriCalls.some((c) => c[0] === "popout_open"), null, { timeout: 5000 }).catch(() => {});
  const pop = await calls(page, "popout_open");
  check(
    "  and with nothing chosen, large and center: what it always did, said out loud",
    pop.length === 1 && pop[0].size === "large" && pop[0].corner === "center",
    JSON.stringify(pop.map((p) => ({ ...p, url: "…" }))),
  );
  await ctx.close();
}

// ------------------------------------------------------------ the delay keys
{
  // mpv already holds +0.5 for this file, so the picture can only say +0.6,
  // +0.7 and +0.6 by showing what native answered.
  const { ctx, page } = await playing({ native: { delay0: 0.5 } });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await page.keyboard.press("x");
  await page.waitForFunction(() => document.querySelector(".sub-delay-toast"), null, { timeout: 3000 }).catch(() => {});
  const t1 = await toast(page);
  await page.keyboard.press("x");
  await page.waitForFunction(() => document.querySelector(".sub-delay-toast")?.textContent === "Subtitles +0.7s", null, { timeout: 3000 }).catch(() => {});
  const t2 = await toast(page);
  await page.keyboard.press("z");
  await page.waitForFunction(() => document.querySelector(".sub-delay-toast")?.textContent === "Subtitles +0.6s", null, { timeout: 3000 }).catch(() => {});
  const t3 = await toast(page);
  const sent = await delays(page);
  check("x, x, z call mpv_sub_delay with +0.1, +0.1, -0.1", JSON.stringify(sent) === JSON.stringify([0.1, 0.1, -0.1]), JSON.stringify(sent));
  check(
    "  and the picture says what native answered each time (+0.6, +0.7, +0.6), not what was added up here",
    t1 === "Subtitles +0.6s" && t2 === "Subtitles +0.7s" && t3 === "Subtitles +0.6s",
    JSON.stringify([t1, t2, t3]),
  );
  const place = await page.evaluate(() => {
    const t = document.querySelector(".sub-delay-toast")?.getBoundingClientRect();
    const slot = document.querySelector("#inv-chrome")?.getBoundingClientRect();
    return t && slot ? { top: Math.round(t.top - slot.top), centre: Math.round(t.left + t.width / 2 - (slot.left + slot.width / 2)), within: t.left >= slot.left && t.right <= slot.right } : null;
  });
  check("  on the picture, top and centre, clear of the subtitles along the bottom", !!place && place.top < 80 && Math.abs(place.centre) <= 2 && place.within, JSON.stringify(place));
  await page.waitForTimeout(2200);
  check("  and it goes by itself a moment later", (await page.locator(".sub-delay-toast").count()) === 0);

  // Shift+Z is mpv's own +0.1, the same as x.
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await page.keyboard.press("Shift+Z");
  await page.waitForTimeout(250);
  check("Shift+Z is x (mpv's own): +0.1", JSON.stringify(await delays(page)) === JSON.stringify([0.1]), JSON.stringify(await delays(page)));
  await ctx.close();
}

// With no subtitle track on, the keys are not the player's.
for (const [label, subs] of [["no subtitle track at all", []], ["a track that is off", SUBS_OFF]]) {
  const { ctx, page } = await playing({ subs });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await page.keyboard.press("z");
  await page.keyboard.press("x");
  await page.keyboard.press("Shift+Z");
  await page.waitForTimeout(400);
  check(`with ${label}, z and x do nothing: no call, no toast`, (await delays(page)).length === 0 && (await page.locator(".sub-delay-toast").count()) === 0, JSON.stringify(await delays(page)));
  await ctx.close();
}

// ------------------------------------------------------------ the menu's Delay line
{
  const { ctx, page } = await playing();
  await page.getByRole("button", { name: "Subtitles", exact: true }).click({ timeout: 5000 });
  const menu = page.locator(".track-menu[aria-label='Subtitles']");
  await menu.waitFor({ timeout: 3000 });
  const line = lineGroup(page);
  const first = await line.evaluate((el) => ({
    label: el.querySelector(".track-menu__delay-label")?.textContent,
    value: el.querySelector(".track-menu__delay-value")?.textContent,
    buttons: [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
    inMenu: !!el.closest(".track-menu"),
  }));
  check(
    "the Subtitles menu has a Delay line: its label, the value (0.0s), and earlier and later, with no Reset at 0",
    first.label === "Delay" && first.value === "0.0s" && first.buttons.join() === "Subtitles earlier,Subtitles later" && first.inMenu,
    JSON.stringify(first),
  );
  const radios = await page.locator(".track-menu [role=menuitemradio]").count();
  check("  and the tracks are still the menu's only choices: Off and one track", radios === 2, String(radios));
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await page.locator("[aria-label='Subtitles later']").click();
  await page.locator("[aria-label='Subtitles later']").click();
  await page.locator("[aria-label='Subtitles earlier']").click();
  await page.waitForTimeout(200);
  const value = await line.locator(".track-menu__delay-value").innerText();
  check("its buttons call mpv_sub_delay (+0.1, +0.1, -0.1) and the line shows +0.1s", JSON.stringify(await delays(page)) === JSON.stringify([0.1, 0.1, -0.1]) && value === "+0.1s", JSON.stringify({ sent: await delays(page), value }));
  check("  and the menu stays open for the next press", (await menu.count()) === 1);
  check("  Reset is there now, and the toast said it too", (await line.locator("[aria-label='Reset subtitle delay']").count()) === 1 && (await toast(page)) === "Subtitles +0.1s", String(await toast(page)));
  await line.locator("[aria-label='Reset subtitle delay']").click();
  await page.waitForTimeout(250);
  const resets = (await calls(page, "mpv_sub_delay_reset")).length;
  const after = await line.locator(".track-menu__delay-value").innerText();
  check("Reset calls mpv_sub_delay_reset, the line reads 0.0s and Reset goes", resets === 1 && after === "0.0s" && (await line.locator("[aria-label='Reset subtitle delay']").count()) === 0, JSON.stringify({ resets, after }));
  // A key moves the line too: one delay, two ways to say it.
  await page.keyboard.press("x");
  await page.waitForTimeout(250);
  check("a key press shows in the open line as well", (await line.locator(".track-menu__delay-value").innerText()) === "+0.1s");
  // Off: the line is for the track that is on.
  await page.locator(".track-menu [role=menuitemradio]").first().click();
  await page.waitForTimeout(200);
  await page.evaluate(() => (window.__subs = [{ id: 3, label: "English", lang: "eng", selected: false }]));
  await page.waitForTimeout(1200);
  await wake(page);
  await page.getByRole("button", { name: "Subtitles", exact: true }).click({ timeout: 5000 });
  await page.locator(".track-menu[aria-label='Subtitles']").waitFor({ timeout: 3000 });
  check("with the track off the menu has no Delay line", (await lineGroup(page).count()) === 0);
  await ctx.close();
}

// ----------------------------------------------------- an older native: no command
{
  const errorsBefore = errors.length;
  const { ctx, page } = await playing({ native: { delay: false } });
  await page.evaluate(() => window.__tauriCalls.splice(0));
  await page.keyboard.press("x");
  await page.waitForTimeout(500);
  await page.keyboard.press("x");
  await page.waitForTimeout(300);
  const asked = (await delays(page)).length;
  check("a native build with no delay command: x is tried once, shows nothing, and is let alone after", asked === 1 && (await page.locator(".sub-delay-toast").count()) === 0, String(asked));
  await wake(page);
  await page.getByRole("button", { name: "Subtitles", exact: true }).click({ timeout: 5000 });
  await page.locator(".track-menu[aria-label='Subtitles']").waitFor({ timeout: 3000 });
  check("  and the Subtitles menu has no Delay line, the tracks as before", (await lineGroup(page).count()) === 0 && (await page.locator(".track-menu [role=menuitemradio]").count()) === 2);
  const un = await unhandled(page);
  check("  and no page error, and no rejection left uncaught", errors.length === errorsBefore && un.length === 0, JSON.stringify({ errors: errors.slice(errorsBefore, errorsBefore + 2), un }));
  await ctx.close();
}

// ------------------------------------------------------------------------ live
// The bare chrome against a mocked overlayApi: the same keys on a live channel.
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 650 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const log = [];
    window.__log = log;
    let delay = 0;
    let tracksCbs = [];
    const unsub = () => () => {};
    window.__setSubs = (subs) => tracksCbs.forEach((cb) => cb({ audio: [], subs }));
    window.overlayApi = {
      close() {}, setPause() {}, setMute() {}, setVolume() {}, seek() {}, expand() {}, collapse() {}, fullscreen() {},
      exitFullscreen() {}, popout() {}, toggleFavorite() {}, setMouseIgnore() {},
      goLive() { log.push("goLive"); },
      selectSub() {},
      subDelay(d) { log.push(["subDelay", d]); delay = Math.round((delay + d) * 10) / 10; return Promise.resolve(delay); },
      subDelayReset() { log.push("subDelayReset"); delay = 0; return Promise.resolve(0); },
      getMeta() { return Promise.resolve({ channelName: "Test One", title: "Now", live: true }); },
      onMeta: unsub, onLoading: unsub, onKey: unsub, onTime: unsub,
      getLoading() { return false; },
      getTime() { return null; },
      getTracks() { return { audio: [], subs: [{ id: 3, label: "English CC", lang: "eng", selected: true }] }; },
      onTracks(cb) { tracksCbs.push(cb); return () => { tracksCbs = tracksCbs.filter((x) => x !== cb); }; },
    };
  });
  await page.goto(APP + "?overlay=1");
  await page.waitForSelector(".theater-overlay");
  await page.mouse.move(550, 300);
  await page.mouse.move(560, 310);
  await page.keyboard.press("x");
  await page.keyboard.press("z");
  await page.keyboard.press("z");
  await page.waitForTimeout(250);
  const log = await page.evaluate(() => window.__log.filter((l) => Array.isArray(l)).map((l) => l[1]));
  check("live: x, z, z are +0.1, -0.1, -0.1 in the same chrome (no VOD gate)", JSON.stringify(log) === JSON.stringify([0.1, -0.1, -0.1]), JSON.stringify(log));
  check("  and the toast says -0.1s", (await toast(page)) === "Subtitles -0.1s", String(await toast(page)));
  // Jump to live reloads the stream, and mpv puts the delay back: so does the line.
  await page.mouse.move(560, 320);
  await page.getByRole("button", { name: "Subtitles", exact: true }).click();
  await page.locator(".track-menu[aria-label='Subtitles']").waitFor();
  const before = await lineGroup(page).locator(".track-menu__delay-value").innerText();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Jump to live", exact: true }).click();
  await page.waitForTimeout(200);
  await page.mouse.move(570, 330);
  await page.getByRole("button", { name: "Subtitles", exact: true }).click();
  await page.locator(".track-menu[aria-label='Subtitles']").waitFor();
  const afterJump = await lineGroup(page).locator(".track-menu__delay-value").innerText();
  check("live: the line reads -0.1s, and 0.0s once the stream is reloaded (Jump to live)", before === "-0.1s" && afterJump === "0.0s", JSON.stringify({ before, afterJump }));
  // No track on: nothing, live too.
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__setSubs([{ id: 3, label: "English CC", lang: "eng", selected: false }]));
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => window.__log.filter((l) => Array.isArray(l)).length);
  await page.keyboard.press("z");
  await page.keyboard.press("x");
  await page.waitForTimeout(200);
  check("live: with the track off, z and x do nothing", (await page.evaluate(() => window.__log.filter((l) => Array.isArray(l)).length)) === n);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
