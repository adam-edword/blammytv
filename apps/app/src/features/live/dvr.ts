/**
 * The live DVR window: how far back this channel can actually be seeked.
 *
 * Live TV has a real rewind buffer and the player had no idea it existed.
 * The rail showed a "how close to live" figure dead-reckoned from what the
 * user had ASKED for, so Back 10s past the start of the buffer walked it
 * left while the picture stayed put. v0.8.194 made that honest by watching
 * `demuxer-cache-duration`, but honest is not the same as informative: it
 * could say "you are 30s behind" without ever saying how far back you are
 * allowed to go, which is the thing you want to know before you press.
 *
 * mpv knows exactly. `demuxer-cache-state` carries `seekable-ranges`, an
 * array of {start,end} on the same timeline as `time-pos`, and its outer
 * bounds ARE the window. Read on a real channel 29 seconds after tuning:
 *
 *   {"seekable-ranges":[{"start":0.0,"end":28.029}], "reader-pts":7.84, …}
 *
 * A caution that cost an afternoon: the top-level numbers are normalised to
 * the playback timeline, but `ts-per-stream[].reader-pts` in the same object
 * is RAW PTS. In that reading they were 7.84 and 2698.48. They are not
 * interchangeable and only the top-level ones match `time-pos`.
 *
 * The window GROWS as you watch, from nothing at tune-in up to whatever
 * `demuxer-max-back-bytes` holds (256MiB, so minutes rather than hours).
 * That is why the bar is drawn from live data every tick instead of being
 * given a fixed span: any span picked in advance would be wrong for the
 * first few minutes of every channel.
 */
export interface DvrWindow {
  /** Earliest seekable second. */
  start: number;
  /** The live edge. */
  end: number;
  /** Where playback is now. */
  pos: number;
}

/**
 * Treat this as "at the live edge", in seconds.
 *
 * The demuxer runs ahead in bursts as segments land, so the gap between
 * `pos` and `end` is never a flat zero even for someone sitting still who
 * has touched nothing. Below this the LIVE pill stays lit.
 */
export const LIVE_TOL = 3;

/** Total rewind available, in seconds. Zero on a window that has not opened
 * yet, which is the first moments of every channel. */
export function dvrDepth(w: DvrWindow): number {
  return Math.max(0, w.end - w.start);
}

/** Seconds behind the live edge. */
export function dvrBehind(w: DvrWindow): number {
  return Math.max(0, w.end - w.pos);
}

export function atLiveEdge(w: DvrWindow): boolean {
  return dvrBehind(w) <= LIVE_TOL;
}

/**
 * Playhead as 0..100 across the window.
 *
 * A window with no depth reads as 100 rather than 0: at tune-in there is
 * nothing to rewind and you are, definitionally, live. Starting an empty
 * bar at the left would say the opposite.
 */
export function dvrPct(w: DvrWindow): number {
  const depth = dvrDepth(w);
  if (depth <= 0) return 100;
  return Math.min(100, Math.max(0, ((w.pos - w.start) / depth) * 100));
}

/** Where a drag to `frac` (0..1) of the rail should seek to, in seconds. */
export function dvrSeekTarget(w: DvrWindow, frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  return w.start + f * dvrDepth(w);
}

/** Whether two readings differ enough to be worth pushing to the chrome.
 * The window's end advances continuously, so without this every poll would
 * re-render the whole overlay. */
export function dvrChanged(a: DvrWindow | null, b: DvrWindow | null): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.start - b.start) > 0.5 ||
    Math.abs(a.end - b.end) > 0.5 ||
    Math.abs(a.pos - b.pos) > 0.5
  );
}
