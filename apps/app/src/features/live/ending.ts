/**
 * Did this file FINISH, or did it DIE? The most expensive question the
 * player asks, and the one with the worst history.
 *
 * Getting it wrong in the "finished" direction is destructive and silent:
 * `onEnded` runs markWatched, pushes the watch entry to dur/dur, and lets Up
 * Next auto-roll the following episode — so a source that died forty minutes
 * into a film is recorded as watched and the real resume position is gone.
 * Getting it wrong the other way costs a dead card at the end of something
 * that actually finished, and the user keeps their position. The asymmetry
 * is the whole design: when unsure, call it a death.
 *
 * TWO REGRESSIONS LIVE HERE, both shipped, both since fixed. They are the
 * reason this is a tested pure function rather than a condition inline in a
 * poll callback.
 *
 * 1. `!time` once counted as PROOF of completion, which inverted the guard
 *    exactly when it mattered. No clock means the source died before one
 *    ever arrived (a debrid 403 seconds in), and that took the completion
 *    path. Duration does land for healthy sources — the VOD scrubber is
 *    proof — so "no clock at EOF" is a death.
 *
 * 2. v0.8.190's seek hold freezes the DISPLAYED clock so a stale poll cannot
 *    yank the scrubber back after a seek. The completion test was reading
 *    that frozen clock. Seek from 95% to 10%, have the source die inside the
 *    1.5s hold, and this function was still being handed 95%. The caller now
 *    passes the last position mpv ACTUALLY reported, which is a different
 *    value from the one on screen and deliberately so.
 *
 * So: `time` here is the unheld truth. If you are wiring this up and reach
 * for the value the scrubber is drawing, that is bug 2 again.
 */

/** What the poll should do about this tick. */
export type EndDecision =
  /** First frame landed: clear `loading`, open the clip hole. */
  | "present"
  /** The file genuinely reached its end. Fire onEnded, once. */
  | "complete"
  /** Playback stopped and it was not a finish. Re-arm the tune watchdog. */
  | "rearm"
  /** Nothing to do. */
  | "none";

export interface EndInputs {
  /** The app is waiting for a first frame. */
  loading: boolean;
  /** mpv reports core-idle false, i.e. a picture is moving. */
  presenting: boolean;
  /** mpv reached EOF or fell back to idle. */
  ended: boolean;
  /**
   * `meta.live === false`. `undefined` means meta has not arrived yet, and
   * is treated as LIVE: a VOD misread as live costs a reload, a live stream
   * misread as VOD costs the user's resume position.
   */
  vod: boolean | undefined;
  /** The last position mpv reported. NOT the held display clock. */
  time: { pos: number; dur: number } | null;
}

/** How far in counts as finished. Credits run long and providers truncate. */
export const COMPLETE_FRAC = 0.9;

export function endDecision(i: EndInputs): EndDecision {
  // ORDER IS LOAD-BEARING. A first frame outranks an EOF flag: during a tune
  // mpv can report both, and treating that as an ending would declare a
  // stream dead at the moment it came alive.
  if (i.loading && i.presenting) return "present";
  if (i.loading || !i.ended) return "none";
  const t = i.time;
  if (i.vod === true && !!t && t.dur > 0 && t.pos >= t.dur * COMPLETE_FRAC)
    return "complete";
  return "rearm";
}
