import { load, save } from "../../lib/storage";

/** How many titles each Stream catalog row loads (10–100, default 40).
 * Feeds source.ts's build — a higher cap means longer catalog loads.
 * Part of the catalog cache key, so changing it triggers a rebuild on
 * the next Stream visit. */

const KEY = "rowCap";
const VERSION = 1;
export const ROW_CAP_MIN = 10;
export const ROW_CAP_MAX = 100;
const DEFAULT = 40;

function clampRowCap(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT;
  return Math.min(ROW_CAP_MAX, Math.max(ROW_CAP_MIN, Math.round(n)));
}

export function loadRowCap(): number {
  return clampRowCap(load<number>(KEY, VERSION, DEFAULT));
}

export function saveRowCap(n: number): number {
  const v = clampRowCap(n);
  save(KEY, VERSION, v);
  return v;
}
