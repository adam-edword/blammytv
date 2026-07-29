import type { VodItem } from "../stream/model";

/**
 * Discover's browse state, held for the life of the app process.
 *
 * Leaving the tab UNMOUNTS DiscoverScreen (App renders one tab at a time),
 * which throws away the loaded feed, the genre, and the scroll position.
 * Coming back then refetched page one and dropped you at the top, so
 * "back" out of a title you picked from Discover never really returned you
 * to where you were.
 *
 * In memory only, and deliberately not persisted: it is a within-session
 * convenience, not a cache with a staleness story. A relaunch fetches
 * fresh, and so does a changed addon (the manifest URL is the key).
 */

export type DiscoverSession = {
  /** The addon this feed came from. A different manifest means different
   * catalogs, so the snapshot is not restorable. */
  key: string;
  filter: "all" | "movie" | "series";
  genre: string | null;
  items: VodItem[];
  /** Per-catalog skip cursors, so infinite scroll continues where it was. */
  cursors: Record<string, number>;
  done: Record<string, boolean>;
  /** Ids already rendered, for the dedupe on the next page. */
  seen: string[];
  exhausted: boolean;
  scroll: number;
};

let held: DiscoverSession | null = null;

export function saveDiscoverSession(s: DiscoverSession): void {
  held = s;
}

/** The snapshot, if it belongs to the addon that is configured now. */
export function readDiscoverSession(key: string): DiscoverSession | null {
  return held && held.key === key ? held : null;
}

