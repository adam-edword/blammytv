import { APP_VERSION } from "./version";

/**
 * Where a hang went, split in two (v0.10.10).
 *
 * Adam: Multi-view's first open in a session freezes the whole app for
 * about three seconds. v0.10.9 timed the two costs a profile of a fake
 * catalog his size pointed at (the channel index, and matching games to
 * channels), and neither printed on his machine, so neither is it. Rather
 * than guess a third time, this answers the question that decides where to
 * look: was the PAGE busy (a long task on its own thread), or was it
 * WAITING on the native side (a slow command; the ones that run on the
 * window's main thread freeze the whole window, not just the page)?
 *
 * Imports nothing of the app's but the version, so tauri.ts and http.ts
 * can report to it without a cycle (playerPerf's reason, same shape).
 *
 * Quiet: one summary, ten seconds after Multi-view's first open in a
 * session, as a console WARNING so no default filter hides it.
 */

interface Call {
  cmd: string;
  start: number;
  dur: number;
}

/** The last calls that took long enough to matter, oldest first. */
const calls: Call[] = [];
const MAX_CALLS = 400;
const SLOW_CALL = 100;

/** Time one native call. Hands the promise back unchanged. */
export function noteCall<T>(cmd: string, p: Promise<T>): Promise<T> {
  const start = performance.now();
  const done = () => {
    const dur = performance.now() - start;
    if (dur < SLOW_CALL) return;
    calls.push({ cmd, start, dur });
    if (calls.length > MAX_CALLS) calls.shift();
  };
  p.then(done, done);
  return p;
}

const longTasks: { start: number; dur: number }[] = [];
let observing = false;
function observeLongTasks(): void {
  if (observing) return;
  observing = true;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration });
      if (longTasks.length > MAX_CALLS) longTasks.splice(0, longTasks.length - MAX_CALLS);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No long-task timing in this engine: the summary says so.
  }
}

let watched = false;
const WINDOW_MS = 10_000;
/** Calls this long before the open still count: leaving the last tab starts
 * its own teardown in the same click. */
const LEAD_MS = 2_000;

/**
 * Watch the next ten seconds, once per session. Call it as the thing opens
 * (its first render, before effects: a long first render is itself a
 * suspect).
 */
export function watchFreeze(what: string): void {
  if (watched) return;
  watched = true;
  observeLongTasks();
  const t0 = performance.now();
  let last = t0;
  let gap = { dur: 0, at: 0 };
  let raf = 0;
  const frame = (t: number) => {
    if (t - last > gap.dur) gap = { dur: t - last, at: last };
    last = t;
    if (t - t0 < WINDOW_MS) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.setTimeout(() => {
    cancelAnimationFrame(raf);
    const s = (t: number) => `${((t - t0) / 1000).toFixed(1)}s`;
    const ms = (n: number) => `${Math.round(n)}ms`;
    const tasks = longTasks
      .filter((l) => l.start >= t0 - LEAD_MS && l.start < t0 + WINDOW_MS)
      .sort((a, b) => b.dur - a.dur);
    const slow = calls.filter((c) => c.start >= t0 - LEAD_MS && c.start < t0 + WINDOW_MS);
    // One entry per command: how many, the longest, and when that one began.
    const byCmd = new Map<string, { n: number; worst: Call }>();
    for (const c of slow) {
      const seen = byCmd.get(c.cmd);
      if (!seen) byCmd.set(c.cmd, { n: 1, worst: c });
      else {
        seen.n++;
        if (c.dur > seen.worst.dur) seen.worst = c;
      }
    }
    const native = [...byCmd]
      .sort((a, b) => b[1].worst.dur - a[1].worst.dur)
      .map(([cmd, { n, worst }]) => `${cmd}${n > 1 ? ` ×${n}, longest` : ""} ${ms(worst.dur)} from ${s(worst.start)}`);
    console.warn(
      [
        `[freeze] ${what}, first open this session (v${APP_VERSION}), its first 10s:`,
        `  longest time without a frame: ${ms(gap.dur)}, from ${s(gap.at)}`,
        `  the page's own long tasks: ${
          observing && typeof PerformanceObserver !== "undefined"
            ? tasks.length
              ? tasks.slice(0, 5).map((l) => `${ms(l.dur)} at ${s(l.start)}`).join(", ")
              : "none"
            : "not measurable here"
        }`,
        `  native calls over ${SLOW_CALL}ms: ${native.length ? native.slice(0, 8).join(" · ") : "none"}`,
      ].join("\n"),
    );
  }, WINDOW_MS);
}
