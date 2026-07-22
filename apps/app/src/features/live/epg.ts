/** Pure time-grid math for the EPG. All positions derive from PX_PER_MIN so
 * the guide's density is one knob. */

import type { Programme } from "./model";

export const PX_PER_MIN = 9.5;
export const GUIDE_HOURS = 4;

/** The guide window opens at the last half-hour boundary. */
export function windowStart(now: Date): Date {
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 0 : 30);
  return start;
}

function windowEnd(start: Date): Date {
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

/**
 * Sanitize one channel's programme list so the guide can never draw
 * overlapping cells. Real provider EPGs ship dirty data — the same
 * programme listed twice with shifted starts ("T20 Blast" at 12:45–16:30
 * AND 12:55–16:30), or an entry bleeding past its neighbour's start.
 *
 * Rules, applied over the start-sorted list:
 *   - non-positive durations are dropped;
 *   - an overlap with the SAME title merges into one entry (earliest
 *     start, latest end) — the duplicate-with-shifted-start case;
 *   - an overlap with a DIFFERENT title clips the earlier entry at the
 *     later one's start (the later, more specific listing wins the
 *     contested span), dropping the earlier one if nothing remains.
 *
 * Pure: the input list and its entries are never mutated.
 */
export function normalizeProgrammes(list: Programme[]): Programme[] {
  const sorted = list
    .filter((p) => p.end.getTime() > p.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Programme[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (!prev || p.start.getTime() >= prev.end.getTime()) {
      out.push({ ...p });
      continue;
    }
    if (sameTitle(prev.title, p.title)) {
      if (p.end.getTime() > prev.end.getTime()) prev.end = p.end;
      if (!prev.synopsis && p.synopsis) prev.synopsis = p.synopsis;
      continue;
    }
    prev.end = p.start;
    if (prev.end.getTime() <= prev.start.getTime()) out.pop();
    out.push({ ...p });
  }
  return out;
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
