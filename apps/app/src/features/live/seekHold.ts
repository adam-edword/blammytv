/**
 * Don't let a stale poll yank the scrubber back after a seek.
 *
 * The chrome moves the bar optimistically on release, because waiting for
 * mpv would make the drag feel dead. The status poll then pushes mpv's real
 * position every tick, unconditionally — and for a moment after a seek that
 * real position is still the OLD one. The bar jumps back to where it was and
 * then forward again a tick later. Measured: a release at 74.8% followed by
 * one stale push read 22.3%.
 *
 * That window is narrow when the seek works. It is the entire rest of
 * playback when it doesn't: an HTTP origin with no range support makes mpv
 * reject the seek silently, so every poll for the next two hours drags the
 * bar back with no explanation.
 *
 * So: after a seek, ignore incoming positions until one lands near where we
 * asked to go. That is a HOLD, not a mute — a seek that genuinely failed has
 * to become visible, or the UI just lies for a fixed delay and then jumps,
 * which is the same bug with extra steps. HOLD_MS is the ceiling on how long
 * we will wait to be proven right before showing the truth.
 */
export interface SeekHold {
  /** Where we asked mpv to go, in seconds. */
  target: number;
  /** performance.now() when we asked. */
  at: number;
}

/**
 * How long to keep believing our own optimistic position.
 *
 * Three status polls at the settled 500ms cadence, so a seek gets several
 * chances to report back before we concede. Long enough to cover the IPC hop
 * plus mpv's playloop, short enough that a rejected seek is visibly wrong
 * quickly rather than eventually.
 */
export const HOLD_MS = 1500;

/**
 * How close counts as landed, in seconds.
 *
 * Not zero, because playback keeps moving: between mpv executing the seek
 * and the next poll reading it, the clock has advanced by up to one poll
 * interval, and more at 2x speed. Two seconds covers that without being wide
 * enough to accept a keyframe seek that missed by a GOP.
 */
export const HOLD_TOL = 2;

/**
 * True if this polled position should be DISCARDED rather than shown.
 *
 * Returns false the moment the hold has served its purpose, either because
 * mpv arrived where we asked or because it has had long enough to; the
 * caller drops the hold on false and goes back to trusting every tick.
 */
export function holdsPoll(
  hold: SeekHold | null,
  pos: number,
  now: number,
): boolean {
  if (!hold) return false;
  // Out of patience. Whatever mpv says now is the truth, including "I never
  // moved" — that is a real answer and the user needs to see it.
  if (now - hold.at >= HOLD_MS) return false;
  return Math.abs(pos - hold.target) > HOLD_TOL;
}

/** The clock the hold is measured against. Same shape as TimeInfo. */
export interface HoldClock {
  pos: number;
  dur: number;
}

/**
 * The hold a RELATIVE seek should arm, or null for no hold.
 *
 * Chains off the outstanding TARGET rather than the last polled position,
 * and that is the whole subtlety. `time` is frozen for as long as a hold is
 * up — that is what a hold is — so a second press in a burst read the
 * PRE-burst position and aimed a full delta short of where mpv was actually
 * going. Press back-10 five times: mpv goes to pos-50, the target said
 * pos-40, the two could never agree, and every burst ended in the timeout
 * and a snap instead of the clean landing the hold exists to give.
 *
 * Clamped the way mpv clamps: back-10 at 0:05 lands at 0:00, so aiming at
 * -5 was aiming somewhere the file does not go.
 */
export function nextHold(
  cur: SeekHold | null,
  time: HoldClock | null,
  seekable: boolean,
  delta: number,
  now: number,
): SeekHold | null {
  // No clock means live (no scrubber to protect). An unseekable source means
  // the seek cannot land, so a hold would show a position mpv will never
  // reach and then snap back HOLD_MS later, on every single press — better
  // to be wrong instantly and let the greyed-out control explain why.
  if (!time || !seekable) return null;
  const from = cur ? cur.target : time.pos;
  return { target: clampTo(time, from + delta), at: now };
}

/** The hold an ABSOLUTE seek should arm. No chaining: the target is stated. */
export function nextHoldAbs(
  time: HoldClock | null,
  seekable: boolean,
  target: number,
  now: number,
): SeekHold | null {
  if (!time || !seekable) return null;
  return { target: clampTo(time, target), at: now };
}

const clampTo = (t: HoldClock, v: number): number =>
  Math.min(t.dur, Math.max(0, v));
