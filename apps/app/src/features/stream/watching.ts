import { hasId, loadList, save } from "../../lib/storage";
import { nextEpisode } from "./mapper";
import type { Episode, Season } from "./model";

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
  /** Trakt's id for this paused position (plan 015, T4), so clearing the
   * card clears it on Trakt too. Only on entries Trakt has seen paused. */
  trakt?: number;
  at: number;
}

const KEY = "watching";
const VERSION = 1;
const CAP = 20;

export function loadWatching(): WatchEntry[] {
  return loadList(KEY, VERSION, hasId<WatchEntry>);
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

/** Replace the whole list (a Trakt sync's merge, plan 015). Capped, as a
 * record is. */
export function replaceWatching(list: WatchEntry[]): WatchEntry[] {
  const capped = list.slice(0, CAP);
  save(KEY, VERSION, capped);
  return capped;
}

/** Told what a clear removed. Trakt listens (plan 015, T4): a card cleared
 * here clears its paused position there, or the next sync brings it back. */
type Cleared = (gone: WatchEntry[]) => void;
const cleared = new Set<Cleared>();
export function onWatchingCleared(fn: Cleared): () => void {
  cleared.add(fn);
  return () => cleared.delete(fn);
}

/** Forget everything watched. Returns the (empty) list so callers set
 * state from the same value the store now holds, as clearWatching does. */
export function clearAllWatching(): WatchEntry[] {
  const gone = loadWatching();
  save(KEY, VERSION, []);
  cleared.forEach((fn) => fn(gone));
  return [];
}

export function clearWatching(id: string): WatchEntry[] {
  const all = loadWatching();
  const list = all.filter((e) => e.id !== id);
  save(KEY, VERSION, list);
  cleared.forEach((fn) => fn(all.filter((e) => e.id === id)));
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

/** At or past 90% of a known duration: the same line resumePoint,
 * retiredFromContinue and the watched ledger draw. */
export function isFinished(e: Pick<WatchEntry, "posSec" | "durSec">): boolean {
  return !!e.posSec && !!e.durSec && e.posSec >= e.durSec * 0.9;
}

/** The episode a click on a Continue Watching series card should start when
 * that card's own is finished: the next one, from its start (the roll
 * retiredFromContinue promises). Null when the card's own episode stands:
 * it is not finished, or nothing follows it (a finale, or the seasons are
 * not known). */
export function rolledForward(
  e: WatchEntry,
  seasons: Season[],
): { season: Season; episode: Episode } | null {
  if (!e.episodeId || !isFinished(e)) return null;
  return nextEpisode(seasons, e.episodeId);
}

/** The progress a new play carries over from the entry it replaces: only a
 * real resume (resumePoint answered, so the same episode, mid-way). A play
 * that starts over writes none. A finished watch that kept its numbers read
 * ~99% to anything that looked before the first progress tick, and the
 * scrobble's stop on leaving sent it to Trakt as another watch. */
export function keptProgress(
  prev: WatchEntry | undefined,
  resumeAt: number | undefined,
): Pick<WatchEntry, "posSec" | "durSec"> {
  if (resumeAt === undefined || !prev) return {};
  return {
    ...(prev.posSec ? { posSec: prev.posSec } : {}),
    ...(prev.durSec ? { durSec: prev.durSec } : {}),
  };
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
