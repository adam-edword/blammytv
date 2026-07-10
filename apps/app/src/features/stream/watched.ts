import { load, save } from "../../lib/storage";

/** Per-series watched-episode ledger — powers the checkmarks in the
 * episode grid. An episode is marked when it plays to its natural end.
 * Capped per series so a long-running anime can't grow unbounded. */

const KEY = "watchedEpisodes";
const VERSION = 1;
const CAP_PER_SERIES = 600;

type WatchedMap = Record<string, string[]>;

export function loadWatched(seriesId: string): Set<string> {
  const map = load<WatchedMap>(KEY, VERSION, {});
  return new Set(map[seriesId] ?? []);
}

export function markWatched(seriesId: string, episodeId: string): void {
  const map = load<WatchedMap>(KEY, VERSION, {});
  const list = map[seriesId] ?? [];
  if (!list.includes(episodeId)) {
    map[seriesId] = [...list, episodeId].slice(-CAP_PER_SERIES);
    save(KEY, VERSION, map);
  }
}
