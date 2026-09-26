import { load, save } from "../../lib/storage";

/**
 * How wide the Sports theater's side column is, set by dragging its edge
 * (Adam, 2026-09-26). Its own key, as the fold is: the Guide's channel
 * column is a different panel on a different screen.
 *
 * 280 to 560, measured on the column's content. Below 280 the Live Scores
 * cards run their clock into the score ("2ND 02:10GB"); past 560 the column
 * is mostly air. The stylesheet also holds it to 40% of the theater, so a
 * window made smaller later can't leave the picture narrower than the rail.
 */
export const SIDE_DEFAULT = 360;
export const SIDE_MIN = 280;
export const SIDE_MAX = 560;

const KEY = "sportsTheaterSideWidth";
const VERSION = 1;

export function clampSide(w: number): number {
  return Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)));
}

export function loadTheaterSide(): number {
  const w = load<number>(KEY, VERSION, SIDE_DEFAULT);
  return typeof w === "number" && Number.isFinite(w) ? clampSide(w) : SIDE_DEFAULT;
}

export function saveTheaterSide(w: number): void {
  save(KEY, VERSION, clampSide(w));
}
