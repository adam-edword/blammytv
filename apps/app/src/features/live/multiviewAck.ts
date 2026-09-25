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
/** 2 since v0.9.124, when a grid opens in Focus wherever Focus is offered
 * (Adam). Choices saved before then were mostly Grid picked over a Grid
 * default, and would have hidden the new one; they start over once. */
const KINDS_VERSION = 2;

export function loadLayoutKinds(): Partial<Record<number, MvKind>> {
  const raw = load<Record<string, unknown>>(KINDS_KEY, KINDS_VERSION, {});
  const out: Partial<Record<number, MvKind>> = {};
  for (const n of [2, 3, 4]) {
    const k = raw?.[n];
    if (k === "grid" || k === "focus") out[n] = k;
  }
  return out;
}

export function saveLayoutKinds(kinds: Partial<Record<number, MvKind>>): void {
  save(KINDS_KEY, KINDS_VERSION, kinds);
}

/**
 * Where you dragged Focus's seam, per tile count (plan 017: "The split is
 * remembered per count"). The big tile's share of the pictures' width, so
 * it survives a different window. No entry means the natural split, which
 * is also what a double-click on the seam or `\` goes back to: it follows
 * the window, where a stored number would not.
 */
const SPLITS_KEY = "multiviewSplits";

export function loadSplits(): Partial<Record<number, number>> {
  const raw = load<Record<string, unknown>>(SPLITS_KEY, VERSION, {});
  const out: Partial<Record<number, number>> = {};
  for (const n of [2, 3, 4]) {
    const s = raw?.[n];
    if (typeof s === "number" && s > 0 && s < 1) out[n] = s;
  }
  return out;
}

export function saveSplits(splits: Partial<Record<number, number>>): void {
  save(SPLITS_KEY, VERSION, splits);
}

/**
 * The sound tile's volume and mute (plan 017, "Sound and volume":
 * "remembered like the main player's"). Its own, not the main player's:
 * muting a grid should not leave the next channel silent.
 */
const VOLUME_KEY = "multiviewVolume";

export interface MvVolume {
  /** 0 to 1, the element's own scale. */
  volume: number;
  muted: boolean;
}

export function loadMvVolume(): MvVolume {
  const raw = load<Partial<MvVolume>>(VOLUME_KEY, VERSION, {});
  const v = raw?.volume;
  return {
    volume: typeof v === "number" && v >= 0 && v <= 1 ? v : 1,
    muted: raw?.muted === true,
  };
}

export function saveMvVolume(v: MvVolume): void {
  save(VOLUME_KEY, VERSION, v);
}
