/**
 * What BlammyTV remembers about Trakt between runs (plan 015). None of it
 * is a credential: the session lives in the OS vault (trakt.rs). This is
 * bookkeeping: when it last synced, the watchlist copy both sides agreed
 * on, Trakt's watched films for the film page's mark (D6), the activity
 * stamps that let a sync skip what has not changed, and the watches that
 * could not be sent yet.
 */

import { load, save } from "../../lib/storage";
import type { HistoryBody } from "./history";
import type { Snapshot } from "./merge";

export interface TraktLocal {
  /** When the last sync finished, ms. */
  lastSync?: number;
  /** `/sync/last_activities` as of that sync, flattened (`movies.paused_at`
   * → ISO time). A section is fetched only when its stamp moved. */
  activities?: Record<string, string>;
  /** The watchlist copy both sides agreed on (merge.ts). */
  watchlistBase?: Snapshot | null;
  /** Trakt's watched films, IMDb id → when last watched (ms). */
  movies?: Record<string, number>;
  /** The first sync's push of what was watched here has been done. */
  pushedHistory?: boolean;
  /** The last thing that went wrong, said plainly, for Settings. */
  problem?: string;
  /** Titles Trakt refused at a free account's cap, and the cap. */
  capped?: { count: number; limit: number | null };
}

const KEY = "trakt";
const VERSION = 1;
const QUEUE = "traktQueue";

export function loadTrakt(): TraktLocal {
  return load<TraktLocal>(KEY, VERSION, {});
}

export function saveTrakt(patch: Partial<TraktLocal>): TraktLocal {
  const next = { ...loadTrakt(), ...patch };
  save(KEY, VERSION, next);
  return next;
}

export function forgetTrakt(): void {
  save(KEY, VERSION, {});
  save(QUEUE, VERSION, []);
}

/** Watches that finished while Trakt could not be reached, each sent later
 * as a history entry dated when it happened. */
export function loadQueue(): HistoryBody[] {
  return load<HistoryBody[]>(QUEUE, VERSION, []);
}

export function queueWatch(body: HistoryBody): void {
  save(QUEUE, VERSION, [...loadQueue(), body].slice(-200));
}

export function clearQueue(): void {
  save(QUEUE, VERSION, []);
}

/** Said by the sync when it changed anything a screen shows (Continue
 * Watching, the ticks, the Trakt Watchlist), so those screens re-read. */
export const TRAKT_SYNCED = "blammytv:trakt-synced";
