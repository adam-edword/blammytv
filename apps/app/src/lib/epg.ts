import type { EpgProgram } from "@blammytv/shared";

/** Horizontal scale for the guide: pixels per minute of airtime. */
export const PX_PER_MIN = 9.5;

/** Half-hour ticks rendered on the time ruler. */
export const SLOT_MIN = 30;

export interface GuideWindow {
  start: number; // epoch ms, floored to a half hour
  end: number; // epoch ms
}

/** Build the visible window: from `slotsBefore` half-hours before now to
 * `slotsAfter` after, snapped to clean half-hour boundaries. */
export function guideWindow(
  now: number,
  slotsBefore = 1,
  slotsAfter = 8,
): GuideWindow {
  const slot = SLOT_MIN * 60_000;
  const base = Math.floor(now / slot) * slot;
  return { start: base - slotsBefore * slot, end: base + slotsAfter * slot };
}

export function ticks(win: GuideWindow): number[] {
  const slot = SLOT_MIN * 60_000;
  const out: number[] = [];
  for (let t = win.start; t <= win.end; t += slot) out.push(t);
  return out;
}

export function minutesFromStart(win: GuideWindow, ms: number): number {
  return (ms - win.start) / 60_000;
}

/** Left/width in px for a program clamped to the window. */
export function blockGeometry(win: GuideWindow, p: EpgProgram) {
  const start = clamp(Date.parse(p.start), win.start, win.end);
  const stop = clamp(Date.parse(p.stop), win.start, win.end);
  const left = minutesFromStart(win, start) * PX_PER_MIN;
  const width = Math.max(0, (stop - start) / 60_000) * PX_PER_MIN;
  return { left, width };
}

export function isLiveNow(p: EpgProgram, now: number): boolean {
  return Date.parse(p.start) <= now && Date.parse(p.stop) > now;
}

export function progressPct(p: EpgProgram, now: number): number {
  const start = Date.parse(p.start);
  const stop = Date.parse(p.stop);
  if (now <= start) return 0;
  if (now >= stop) return 100;
  return ((now - start) / (stop - start)) * 100;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
