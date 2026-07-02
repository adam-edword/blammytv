/** Pure time-grid math for the EPG. All positions derive from PX_PER_MIN so
 * the guide's density is one knob. */

export const PX_PER_MIN = 9.5;
export const GUIDE_HOURS = 4;

/** The guide window opens at the last half-hour boundary. */
export function windowStart(now: Date): Date {
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 0 : 30);
  return start;
}

export function windowEnd(start: Date): Date {
  return new Date(start.getTime() + GUIDE_HOURS * 60 * 60_000);
}

/** Half-hour tick marks across the window. */
export function ticks(start: Date): Date[] {
  return Array.from(
    { length: GUIDE_HOURS * 2 },
    (_, i) => new Date(start.getTime() + i * 30 * 60_000),
  );
}

/** Horizontal position of a moment, in px from the window's left edge. */
export function xForTime(t: Date, start: Date): number {
  return ((t.getTime() - start.getTime()) / 60_000) * PX_PER_MIN;
}

/** A programme cell's clamped rectangle, or null when it's off-window. */
export function cellRect(
  progStart: Date,
  progEnd: Date,
  start: Date,
): { x: number; w: number } | null {
  const end = windowEnd(start);
  const from = Math.max(progStart.getTime(), start.getTime());
  const to = Math.min(progEnd.getTime(), end.getTime());
  if (to <= from) return null;
  const x = ((from - start.getTime()) / 60_000) * PX_PER_MIN;
  const w = ((to - from) / 60_000) * PX_PER_MIN;
  return { x, w };
}

/** 0..1 progress of a programme at `now` (clamped). */
export function progress(progStart: Date, progEnd: Date, now: Date): number {
  const span = progEnd.getTime() - progStart.getTime();
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (now.getTime() - progStart.getTime()) / span));
}
