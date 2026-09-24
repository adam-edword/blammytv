import { load, save } from "../../lib/storage";
import type { GridSize } from "./multiview";
import type { MvKind } from "./mvLayout";

/**
 * What multi-view remembers between sessions (plan 013): the notice, the
 * grid size, and (plan 017) Grid or Focus for each size.
 *
 * Whether the notice has been acknowledged.
 *
 * Adam's call: shown on first open, "Got it", never again. Its own module
 * rather than state inside the component, for the reason every other
 * preference here has one — the component unmounts with the grid, and a
 * flag that dies with its component is a notice that comes back.
 *
 * Not a settings-tab preference. There is deliberately no UI to un-see it:
 * the notice exists to be read once before the first grid, and a toggle for
 * re-reading it would be a control nobody looks for.
 */
const KEY = "multiviewNoticeSeen";
const VERSION = 1;

export function multiviewNoticeSeen(): boolean {
  return load<boolean>(KEY, VERSION, false) === true;
}

export function markMultiviewNoticeSeen(): void {
  save(KEY, VERSION, true);
}

/**
 * The grid size the viewer last chose.
 *
 * Remembered rather than reset, because it is a statement about their
 * machine and their line rather than about tonight's games. Clamped on read
 * to a real size; `usableSize` then clamps it again to what the line can
 * feed, which is the check that can change between playlists.
 */
const SIZE_KEY = "multiviewSize";

export function loadGridSize(): GridSize {
  const n = load<number>(SIZE_KEY, VERSION, 2);
  return n === 2 || n === 3 || n === 4 ? n : 2;
}

export function saveGridSize(n: GridSize): void {
  save(SIZE_KEY, VERSION, n);
}

/**
 * Grid or Focus, per tile count (plan 017, "Layouts": "The switch is
 * remembered per count"). Per count because the right answer differs by
 * count: three is Focus by default and four is Grid, and flipping one
 * should not flip the other.
 */
const KINDS_KEY = "multiviewLayouts";

export function loadLayoutKinds(): Partial<Record<GridSize, MvKind>> {
  const raw = load<Record<string, unknown>>(KINDS_KEY, VERSION, {});
  const out: Partial<Record<GridSize, MvKind>> = {};
  for (const n of [2, 3, 4] as const) {
    const k = raw?.[n];
    if (k === "grid" || k === "focus") out[n] = k;
  }
  return out;
}

export function saveLayoutKinds(kinds: Partial<Record<GridSize, MvKind>>): void {
  save(KINDS_KEY, VERSION, kinds);
}
