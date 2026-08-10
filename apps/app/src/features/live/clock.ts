/**
 * The playback clock between polls.
 *
 * mpv is asked for its position twice a second and the readout shows whole
 * seconds, so the displayed digit advanced on a 500ms grid that does not line
 * up with a 1s one: it sat still for one tick, moved on the next, sat still,
 * moved twice. Nothing was wrong with the number, it just visibly stuttered
 * in a way a clock should not.
 *
 * Plan 012 proposed polling at 200ms instead. That reduces the jitter without
 * removing it (200 does not divide 1000 evenly against an arbitrary phase
 * either) and costs 2.5 more IPC round trips a second forever. Projecting
 * locally removes it completely and costs nothing: position advances at
 * exactly `speed` seconds per second, which is a fact about playback rather
 * than a guess about it.
 *
 * The projection is ANCHORED, never accumulated: every poll replaces the
 * anchor outright, so drift cannot build up and a seek lands immediately. If
 * mpv and the projection disagree, mpv wins on the next tick.
 */

/** How often the projected clock is recomputed. Fine enough that the second
 * it shows flips within 100ms of when it should, coarse enough that this is
 * ten string builds a second and not sixty. */
export const CLOCK_TICK_MS = 100;

/**
 * Where playback is now, given the last real reading.
 *
 * Clamped to the duration: a file at its end reports a position that stops
 * while wall clock keeps going, and an unclamped projection would run the
 * readout past the length of the film.
 */
export function projectPos(
  anchorPos: number,
  anchorAt: number,
  now: number,
  speed: number,
  dur: number,
): number {
  const elapsed = Math.max(0, now - anchorAt) / 1000;
  return Math.min(dur, Math.max(0, anchorPos + elapsed * speed));
}
