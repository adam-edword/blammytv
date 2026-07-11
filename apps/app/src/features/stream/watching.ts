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
  /** Clearlogo title art — the resolving/loading screens prefer it. */
  logo?: string;
  rating?: number;
  year?: number;
  runtimeMin?: number;
  /** First genre + kind, captured at play time for the card meta line
   * (absent on entries recorded before they existed). */
  genre?: string;
  kind?: "movie" | "series";
  /** Episode identity for quick-resume's overlay heading. */
  season?: number;
  episode?: number;
  epTitle?: string;
  /** Last playback position/duration in seconds (the 5s progress tick).
   * Powers resume-from-position and the card's progress bar. */
  posSec?: number;
  durSec?: number;
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

/** Periodic position tick for whatever's playing — updates in place,
 * no reorder (the entry is already front from recordWatching). */
export function updateWatchingProgress(
  id: string,
  posSec: number,
  durSec?: number,
): WatchEntry[] {
  const list = loadWatching().map((e) =>
    e.id === id
      ? { ...e, posSec, ...(durSec ? { durSec } : {}) }
      : e,
  );
  save(KEY, VERSION, list);
  return list;
}

/** Where to resume this entry, or undefined for start-from-zero: needs a
 * meaningful position (>60s in), not effectively finished (≥90% when the
 * duration is known — the SAME threshold as the watched ledger and
 * retiredFromContinue, so a "finished" title always restarts instead of
 * resuming into its own credits), and — for series — the SAME episode.
 * Rewinds a few seconds so the cut lands before where you left off. */
export function resumePoint(
  e: WatchEntry | undefined,
  episodeId?: string,
): number | undefined {
  if (!e?.posSec || e.posSec <= 60) return undefined;
  if (episodeId && e.episodeId !== episodeId) return undefined;
  if (e.durSec && e.posSec >= e.durSec * 0.9) return undefined;
  return Math.max(0, e.posSec - 3);
}

/** Finished MOVIES leave the Continue Watching row (≥90% — the same
 * threshold the watched ledger uses); a rewatch starts from any other
 * card. Series entries always stay: smart resume rolls them forward to
 * the next episode instead. The entry itself is kept (display filter
 * only) so nothing is lost if the threshold ever changes. */
export function retiredFromContinue(e: WatchEntry): boolean {
  return (
    !e.episodeId && !!e.posSec && !!e.durSec && e.posSec >= e.durSec * 0.9
  );
}
