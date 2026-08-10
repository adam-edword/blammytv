/**
 * Player perf probe (plan 011). Answers, with numbers from a real machine,
 * the two questions this container cannot: what does the 500ms status poll
 * cost the UI thread, and is the video pipeline actually dropping frames.
 *
 * Run it from the devtools console WHILE SOMETHING IS PLAYING:
 *
 *   await playerPerf()      // 20s window, then prints a report
 *   await playerPerf(60)    // longer window
 *
 * The report separates three things that all read as "jank" but have
 * different fixes:
 *   NATIVE  — time inside mpv_status. It is a SYNC Tauri command, so on
 *             Windows this runs in WebView2's callback, on the UI thread.
 *             Split by segment, because tracks+chapters are static for a
 *             loaded file and re-read twice a second regardless.
 *   VIDEO   — mpv's own drop counters. Zero drops with a slow poll means
 *             the stutter is ours; drops mean it is decode or output.
 *   WEBVIEW — the JS-side round trip for the same call, plus long tasks.
 *             The gap between this and NATIVE is IPC and scheduling.
 *
 * Always compiled in. A probe that only exists in a special build is a probe
 * you cannot ask someone to run when the problem is in front of them.
 */
// Talks to invoke DIRECTLY rather than through tauri.ts. tauri.ts imports
// notePoll from here, so importing back would make the pair a cycle whose
// initialisation order decides whether notePoll exists yet.
import { invoke } from "@tauri-apps/api/core";

const inShell = (): boolean => "__TAURI_INTERNALS__" in window;

/** JS-side round-trip samples for mpv_status, in ms. Bounded — a long
 * session must not grow this without limit. */
const polls: number[] = [];
const MAX_SAMPLES = 4096;

/** Called by tauriMpvStatus on every poll. One Date.now() pair per 500ms. */
export function notePoll(ms: number): void {
  if (polls.length >= MAX_SAMPLES) polls.shift();
  polls.push(ms);
}

/** Status-poll cost + mpv's drop counters. `reset` zeroes the native
 * accumulator so a report covers a known window. */
async function mpvPerf(reset: boolean): Promise<unknown> {
  return JSON.parse(await invoke<string>("mpv_perf", { reset }));
}

function stats(xs: number[]): { avg: number; max: number; p95: number } {
  if (xs.length === 0) return { avg: 0, max: 0, p95: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    avg: xs.reduce((a, b) => a + b, 0) / xs.length,
    max: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}

const ms = (n: number) => `${n.toFixed(1)}ms`;
const us = (n: number) => `${(n / 1000).toFixed(2)}ms`;

interface NativePerf {
  calls: number;
  propReads: number;
  avgUs: number;
  maxUs: number;
  scalarsUs: number;
  tracksUs: number;
  chaptersUs: number;
  over16ms: number;
  frameDrops: number;
  voDelayed: number;
  fps: number;
  hwdec: string;
}

async function collect(seconds: number): Promise<string> {
  if (!inShell()) return "playerPerf: not running in the Tauri shell.";

  // Long tasks are what actually reads as stutter — anything over 50ms on
  // the main thread is a visibly missed frame or three.
  const long: number[] = [];
  let obs: PerformanceObserver | null = null;
  try {
    obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) long.push(e.duration);
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    /* not all webviews expose longtask; the rest of the report still works */
  }

  polls.length = 0;
  await mpvPerf(true).catch(() => null); // zero the native accumulator
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const wall = (performance.now() - t0) / 1000;
  const n = (await mpvPerf(false).catch(() => null)) as NativePerf | null;
  obs?.disconnect();

  if (!n) return "playerPerf: mpv_perf unavailable (old native build?).";

  const js = stats(polls);
  const longs = long.filter((d) => d >= 50);
  const perPoll = n.calls > 0 ? n.propReads / n.calls : 0;
  // Share of one core spent inside the status poll on the UI thread.
  const load = n.calls > 0 ? ((n.avgUs * n.calls) / 1000 / (wall * 1000)) * 100 : 0;

  return [
    ``,
    `BlammyTV player perf — ${wall.toFixed(1)}s window`,
    ``,
    `  NATIVE  mpv_status (sync command, runs on the UI thread)`,
    `    calls              ${n.calls}   (expect ~${Math.round(wall * 2)} at 500ms)`,
    `    property reads     ${n.propReads}   (${perPoll.toFixed(0)} per poll)`,
    `    avg                ${us(n.avgUs)}   scalars ${us(n.scalarsUs)} · tracks ${us(n.tracksUs)} · chapters ${us(n.chaptersUs)}`,
    `    max                ${us(n.maxUs)}`,
    `    polls over 16ms    ${n.over16ms}   (a poll longer than a 60Hz frame)`,
    `    UI-thread load     ${load.toFixed(2)}% of one core`,
    ``,
    `  VIDEO   mpv's own counters`,
    `    frame drops        ${n.frameDrops < 0 ? "n/a" : n.frameDrops}`,
    `    vo delayed frames  ${n.voDelayed < 0 ? "n/a" : n.voDelayed}`,
    `    fps                ${n.fps < 0 ? "n/a" : n.fps.toFixed(2)}`,
    `    hwdec              ${n.hwdec || "n/a"}`,
    ``,
    `  WEBVIEW  same call, measured from JS (IPC + scheduling on top)`,
    `    samples            ${polls.length}`,
    `    avg / p95 / max    ${ms(js.avg)} / ${ms(js.p95)} / ${ms(js.max)}`,
    `    long tasks ≥50ms   ${longs.length}${longs.length ? `   (worst ${ms(Math.max(...longs))})` : ""}`,
    ``,
  ].join("\n");
}

declare global {
  interface Window {
    playerPerf?: (seconds?: number) => Promise<void>;
    playerDiag?: () => Promise<void>;
    mpvSet?: (key: string, value: string | number) => Promise<void>;
    mpvGet?: (key: string) => Promise<void>;
    ttff?: (seconds?: number) => Promise<void>;
  }
}

/**
 * `await playerDiag()` — one snapshot of what mpv thinks is happening.
 *
 * The question this answers, and the reason it is a one-liner rather than a
 * devtools expedition: when a stream sits buffering forever, is the picture
 * genuinely not arriving, or is the app simply unable to SEE that it has?
 * `presenting` is derived from core-idle, and core-idle reads "yes" both
 * when paused and when waiting on the cache — so the difference between "the
 * source is dead", "we left it paused" and "the video output never
 * reconfigured" is invisible from the UI and obvious here.
 *
 * Read it as:
 *   pause "yes"                  -> we left it paused; not the source's fault
 *   has-path false               -> nothing is loaded at all
 *   file-format set, core-idle
 *     "yes", cache time growing  -> it is buffering, genuinely
 *   file-format set but
 *     current-vo "<none>"        -> demuxed fine, never got a video output
 */
async function diag(): Promise<string> {
  if (!inShell()) return "playerDiag: not running in the Tauri shell.";
  // JSON.stringify, not interpolation: Tauri command errors are strings
  // that routinely contain quotes, so a hand-built literal made the parse
  // below throw and playerDiag reported a SyntaxError instead of the fault.
  const raw = await invoke<string>("mpv_diag").catch((e) =>
    JSON.stringify({ error: String(e) }),
  );
  const d = JSON.parse(raw) as Record<string, unknown>;
  const rows = Object.entries(d).map(([k, v]) => `    ${k.padEnd(22)} ${String(v)}`);
  return ["", "mpv says:", "", ...rows, ""].join("\n");
}

/**
 * `mpvSet("cache-secs", "20")` / `mpvGet("demuxer-cache-time")`
 *
 * A/B an mpv option against a real stream without a rebuild. Returns what
 * the property reads as AFTERWARDS, which is the point: mpv silently ignores
 * an unknown or unwritable property, so the read-back is the difference
 * between "I set it" and "it took".
 *
 * Not everything can be changed at runtime. Options mpv only consults when
 * the demuxer opens (probe sizes, most cache sizing) need the next `loadfile`
 * to take effect, so set them and then switch channel or restart the title
 * rather than expecting the current stream to change under you.
 */
async function setProp(key: string, value: string): Promise<string> {
  if (!inShell()) return "not running in the Tauri shell.";
  return invoke<string>("mpv_set", { key, value });
}

async function getProp(key: string): Promise<string> {
  if (!inShell()) return "not running in the Tauri shell.";
  return invoke<string>("mpv_get", { key });
}

/**
 * TIME TO FIRST FRAME, which is the number every startup suggestion has to
 * be scored against and the one this app could not previously produce.
 *
 * `await ttff()` arms it, then you tune a channel or start a title. It polls
 * mpv directly rather than watching React, so it measures the player and not
 * the interface, and it reports the three legs separately because they have
 * different fixes:
 *
 *   demux    loadfile accepted to `file-format` known. Network reach plus
 *            however much of the stream mpv probed before it was satisfied.
 *   video    to `dwidth` CHANGING. Decoder and output bring-up, i.e. hwdec.
 *   frame    to `core-idle` false. The picture is actually moving.
 *
 * A change that improves the total but moves it into a different leg is not
 * the same change, and one number cannot tell you that.
 *
 * TWO THINGS THIS GOT WRONG when it landed in v0.8.186, both of which made it
 * report numbers rather than refuse to:
 *
 * 1. It claimed to wait for the current file to go away and did not. It armed
 *    on the first poll where `has-path` was true, so running it while a stream
 *    was up returned about 25ms and looked like a triumph. The wait is real
 *    now, and it is the whole reason the arm means anything.
 * 2. The video leg read `current-vo`, which the app sets `force-window=yes`
 *    for, so the VO exists from launch and never goes away between files. The
 *    leg was structurally zero, and when `file-format` happened to land after
 *    the first poll the printed number went NEGATIVE.
 *
 * The v0.8.188 fix for (2) swapped in `dwidth` and did not work: measured on
 * a real remux it marked the leg 27ms after loadfile was accepted and 2.7s
 * BEFORE `file-format` was known, which is impossible for a file that had not
 * yet been identified. `dwidth` survives an unload the same way `current-vo`
 * does, so it was the previous file's width. One always-wrong property traded
 * for another.
 *
 * So the leg is now marked on `dwidth` CHANGING from what it read while idle,
 * and never before `file-format`. When the next file happens to have the same
 * dimensions as the last there is nothing to observe, and it says so instead
 * of printing a number. An instrument that admits it cannot separate two
 * things beats one that separates them wrongly — the total is unaffected
 * either way, and the total is the number being navigated by.
 */
async function ttff(timeoutSec = 40): Promise<string> {
  if (!inShell()) return "ttff: not running in the Tauri shell.";
  const read = async () => JSON.parse(await invoke<string>("mpv_diag")) as Record<string, string>;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const known = (v: string | undefined) => !!v && v !== "<none>";
  /**
   * Wait for the CURRENT file to go away, so the arm is unambiguous: without
   * this a stream already playing satisfies every stage instantly.
   *
   * Returns the idle `dwidth` as the baseline the video leg has to differ
   * from, or null if we should give up. A helper rather than an inline loop
   * so the baseline can be a const: there is exactly one place it is decided.
   */
  const waitIdle = async (): Promise<string | null> => {
    const idleBy = performance.now() + timeoutSec * 1000;
    let warned = false;
    for (;;) {
      const d = await read().catch(() => null);
      if (!d) return null;
      if (String(d["has-path"]) !== "true")
        return known(d["dwidth"]) ? d["dwidth"] : "";
      if (!warned) {
        warned = true;
        console.info("ttff: a stream is playing. Close it, then start one…");
      }
      if (performance.now() > idleBy) return null;
      await sleep(25);
    }
  };
  const baseW = await waitIdle();
  if (baseW === null)
    return "ttff: a stream never stopped, or mpv could not be read.";
  console.info("ttff: armed. Start a channel or a title now…");
  const t0 = performance.now();
  const deadline = t0 + timeoutSec * 1000;
  let started = 0;
  let demux = 0;
  let video = 0;
  // 25ms, not the app's 500ms poll: this is measuring something the 500ms
  // poll is too coarse to see the shape of.
  while (performance.now() < deadline) {
    const d = await read().catch(() => null);
    if (!d) break;
    const has = String(d["has-path"]) === "true";
    if (!started) {
      if (has) started = performance.now();
    } else {
      if (!demux && known(d["file-format"])) demux = performance.now();
      // Never before demux (nothing can know its width before its container)
      // and never on a value carried over from the last file.
      if (!video && demux && known(d["dwidth"]) && d["dwidth"] !== baseW)
        video = performance.now();
      // NOT gated on `video`: it may never be trustworthy, and waiting for it
      // would hang the whole measurement on a file that happens to match the
      // previous one's dimensions.
      if (demux && d["core-idle"] === "no") {
        const frame = performance.now();
        const ms = (a: number, b: number) => `${Math.round(b - a)}ms`;
        return [
          "",
          `time to first frame: ${ms(started, frame)}`,
          "",
          `  demux   ${ms(started, demux).padStart(7)}   loadfile to file-format known`,
          video
            ? `  video   ${ms(demux, video).padStart(7)}   to dwidth (decoder + output bring-up)`
            : `  video       n/a   dwidth never left ${baseW || "<unset>"}, so this leg and the next can't be split`,
          `  frame   ${ms(video || demux, frame).padStart(7)}   to core-idle false (picture moving)`,
          "",
          `  hwdec ${d["hwdec-current"] ?? "?"} · format ${d["file-format"]} · vo ${d["current-vo"]}`,
          "",
        ].join("\n");
      }
    }
    await sleep(25);
  }
  return started
    ? "ttff: timed out mid-load. It never reached a moving picture."
    : "ttff: nothing started within the window.";
}

/** Install the console entry points. Called once from main.tsx. */
export function installPlayerPerf(): void {
  window.playerPerf = async (seconds = 20) => {
    console.info(`playerPerf: sampling for ${seconds}s — leave it playing…`);
    console.info(await collect(seconds));
  };
  window.playerDiag = async () => {
    console.info(await diag());
  };
  window.mpvSet = async (key, value) => {
    console.info(`${key} = ${await setProp(key, String(value))}`);
  };
  window.mpvGet = async (key) => {
    console.info(`${key} = ${await getProp(key)}`);
  };
  window.ttff = async (seconds = 40) => {
    console.info(await ttff(seconds));
  };
}
