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
 *
 * A THIRD QUESTION, asked while still loading: did a VOD never OPEN? A debrid
 * link that answers 403 or 404, or has expired into a web page, is given up on
 * by mpv within ~50ms of the `loadfile` (measured on mpv 0.37: end-file
 * reason=error, then `idle-active=yes` with no `path`, and it stays there).
 * Until v0.11.33 that was ignored while `loading` and the card came at the
 * 40s watchdog. A healthy file, and one on a server that takes 4s to answer,
 * read `idle-active=no` the whole time, so a slow open is never mistaken for
 * this. See `looksFailedOpen` for what a poll has to show, and why.
 */

/** What the poll should do about this tick. */
export type EndDecision =
  /** First frame landed: clear `loading`, open the clip hole. */
  | "present"
  /** The file genuinely reached its end. Fire onEnded, once. */
  | "complete"
  /** Playback stopped and it was not a finish. Re-arm the tune watchdog. */
  | "rearm"
  /** A VOD that is idle after its load, so it is not going to open: call it
   * dead now rather than at the watchdog. */
  | "failed-open"
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
  /**
   * Milliseconds since native last asked mpv for a file (mpv_status), null
   * when nothing is loaded. Absent on a native build from before v0.11.33,
   * and absent reads as unknown: no fast verdict, the watchdog as ever.
   */
  sinceLoadMs?: number | null;
  /**
   * How many polls in a row, just before this one, `looksFailedOpen`. The
   * caller counts them (useDirectOverlay); one poll alone decides nothing.
   */
  priorFailedPolls?: number;
}

/** How far in counts as finished. Credits run long and providers truncate. */
export const COMPLETE_FRAC = 0.9;

/**
 * How long after the load an idle has to be before it counts. mpv gives up on
 * a dead link within ~50ms, so a second is far past it; what it guards is the
 * other idle, the one BEFORE the new `loadfile` lands (the last file's, which
 * reads exactly the same). Native resets its clock at the `loadfile`, so that
 * idle reads a few milliseconds, or null, and never reaches this.
 */
export const FAILED_OPEN_MS = 1000;

/** Polls in a row it takes. Polls run 100ms apart while loading, so this is
 * ~100ms more; it is what makes a single stray idle read harmless. */
export const FAILED_OPEN_POLLS = 2;

/**
 * Does this ONE poll look like a VOD that is never going to open? Every part
 * is load-bearing:
 *
 * - `vod === true`. Live is left alone: its silent reloads are how a live line
 *   recovers, and a live 403 is often the provider's connection limit, which a
 *   reload clears. Unknown meta is live, as everywhere here.
 * - `loading` and not `presenting`: still waiting on a first frame.
 * - `ended`: mpv is idle (or at EOF) with the file it was asked for.
 * - `sinceLoadMs >= FAILED_OPEN_MS`: that idle came AFTER a load, not before.
 *
 * It also covers a VOD that died mid-play and was re-armed ("rearm" flips
 * `loading` back on): it is idle, VOD never reloads itself, and nothing brings
 * it back, so the 40s wait bought nothing.
 */
export function looksFailedOpen(i: EndInputs): boolean {
  return (
    i.vod === true &&
    i.loading &&
    !i.presenting &&
    i.ended &&
    typeof i.sinceLoadMs === "number" &&
    i.sinceLoadMs >= FAILED_OPEN_MS
  );
}

export function endDecision(i: EndInputs): EndDecision {
  // ORDER IS LOAD-BEARING. A first frame outranks an EOF flag: during a tune
  // mpv can report both, and treating that as an ending would declare a
  // stream dead at the moment it came alive.
  if (i.loading && i.presenting) return "present";
  if (i.loading)
    return looksFailedOpen(i) && (i.priorFailedPolls ?? 0) + 1 >= FAILED_OPEN_POLLS
      ? "failed-open"
      : "none";
  if (!i.ended) return "none";
  const t = i.time;
  if (i.vod === true && !!t && t.dur > 0 && t.pos >= t.dur * COMPLETE_FRAC)
    return "complete";
  return "rearm";
}
