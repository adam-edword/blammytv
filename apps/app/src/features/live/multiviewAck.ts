import { load, save } from "../../lib/storage";
import type { MvKind } from "./mvLayout";
import { MAX_TILES, type Pick } from "./mvGrid";

/**
 * What multi-view remembers between sessions: the notice (plan 013), and
 * (plan 017) the grid itself and Grid or Focus for each count.
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
 * The grid itself: its channels, in order, and which one had the sound
 * (plan 017, decision M7: "remember the grid between visits", across
 * launches). Rebuilding a grid is the most tedious part of using one, and
 * channel ids are stable. A remembered channel that has since left the
 * catalog is dropped when the catalog arrives (MultiviewTab).
 *
 * This replaced the 2 / 3 / 4 size that used to be remembered here: the
 * count follows the channels now (M8).
 */
const GRID_KEY = "multiviewGrid";

export interface SavedGrid {
  picks: Pick[];
  sound: string | null;
}

export function loadGrid(): SavedGrid {
  const raw = load<Partial<SavedGrid>>(GRID_KEY, VERSION, {});
  const picks = Array.isArray(raw?.picks)
    ? raw.picks
        .filter(
          (p): p is Pick =>
            !!p && typeof p.channelId === "string" && typeof p.label === "string",
        )
        .slice(0, MAX_TILES)
    : [];
  const sound = typeof raw?.sound === "string" ? raw.sound : null;
  return { picks, sound };
}

export function saveGrid(grid: SavedGrid): void {
  save(GRID_KEY, VERSION, grid);
}

/**
 * Grid or Focus, per tile count (plan 017, "Layouts": "The switch is
 * remembered per count"). Per count because the right answer differs by
 * count: three is Focus by default and four is Grid, and flipping one
 * should not flip the other.
 */
const KINDS_KEY = "multiviewLayouts";

export function loadLayoutKinds(): Partial<Record<number, MvKind>> {
  const raw = load<Record<string, unknown>>(KINDS_KEY, VERSION, {});
  const out: Partial<Record<number, MvKind>> = {};
  for (const n of [2, 3, 4]) {
    const k = raw?.[n];
    if (k === "grid" || k === "focus") out[n] = k;
  }
  return out;
}

export function saveLayoutKinds(kinds: Partial<Record<number, MvKind>>): void {
  save(KINDS_KEY, VERSION, kinds);
}
