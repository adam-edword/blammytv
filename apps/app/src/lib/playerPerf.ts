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
  const raw = await invoke<string>("mpv_diag").catch((e) => `{"error":"${e}"}`);
  const d = JSON.parse(raw) as Record<string, unknown>;
  const rows = Object.entries(d).map(([k, v]) => `    ${k.padEnd(22)} ${String(v)}`);
  return ["", "mpv says:", "", ...rows, ""].join("\n");
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
}
