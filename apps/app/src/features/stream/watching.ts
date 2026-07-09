import { load, save } from "../../lib/storage";

/**
 * Continue Watching: a recency-ordered record of what was played in the
 * Stream tab. Position tracking arrives with the VOD scrubber work — for
 * now an entry means "you were here", which is what the row needs to
 * exist. Hold-to-clear removes one entry (the Figma interaction).
 */
export interface WatchEntry {
  /** Title id; episodes carry the episode stream id too. */
  id: string;
  episodeId?: string;
  title: string;
  /** Episode label ("S1 · E4 — …") when applicable. */
  label?: string;
  /** Landscape art preferred (backdrop), poster fallback. */
  art?: string;
  rating?: number;
  year?: number;
  runtimeMin?: number;
  /** First genre + kind, captured at play time for the card meta line
   * (absent on entries recorded before they existed). */
  genre?: string;
  kind?: "movie" | "series";
  at: number;
}

const KEY = "watching";
const VERSION = 1;
const CAP = 20;

export function loadWatching(): WatchEntry[] {
  return load<WatchEntry[]>(KEY, VERSION, []);
}

/** Move-to-front on the title id (an episode replaces its sibling). */
export function recordWatching(entry: WatchEntry): WatchEntry[] {
  const list = [
    entry,
    ...loadWatching().filter((e) => e.id !== entry.id),
  ].slice(0, CAP);
  save(KEY, VERSION, list);
  return list;
}

export function clearWatching(id: string): WatchEntry[] {
  const list = loadWatching().filter((e) => e.id !== id);
  save(KEY, VERSION, list);
  return list;
}
