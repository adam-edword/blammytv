/**
 * What was watched, between Trakt and BlammyTV (plan 015, T3 and D3).
 *
 * A watch is a fact, so nothing here ever deletes one from Trakt. Coming
 * in, Trakt is the ledger: the episode checkmarks become exactly Trakt's,
 * so an episode un-marked on Trakt un-ticks here too, BlammyTV having no
 * un-mark of its own. On the first sync, what BlammyTV already ticked goes
 * to Trakt once, first, so the ledger that comes back includes it.
 *
 * Pure: Trakt's answers in, what to send and what to keep out.
 */

import { episodeId, episodeRef, imdbOf, type TraktIds } from "./ids";

/** `/sync/watched/shows`, the fields used. */
export interface WatchedShow {
  show: { title?: string; year?: number; ids: TraktIds };
  seasons?: { number: number; episodes: { number: number; last_watched_at?: string }[] }[];
}

/** `/sync/watched/movies`, the fields used. */
export interface WatchedMovie {
  last_watched_at?: string;
  movie: { title?: string; year?: number; ids: TraktIds };
}

/** Series id → its watched episode ids, the app's `watchedEpisodes` shape. */
export type Ledger = Record<string, string[]>;

/** `/sync/history` POST body. */
export interface HistoryBody {
  movies?: { ids: { imdb: string }; watched_at?: string }[];
  shows?: {
    ids: { imdb: string };
    seasons: { number: number; episodes: { number: number; watched_at?: string }[] }[];
  }[];
}

/** Trakt's watched shows as the app's episode ledger. Shows with no IMDb id
 * are left out (D5). */
export function ledgerFromTrakt(shows: readonly WatchedShow[]): Ledger {
  const out: Ledger = {};
  for (const s of shows) {
    const id = s.show.ids.imdb && imdbOf(s.show.ids.imdb);
    if (!id) continue;
    const eps: string[] = [];
    for (const season of s.seasons ?? [])
      for (const e of season.episodes) eps.push(episodeId(id, season.number, e.number));
    if (eps.length) out[id] = eps;
  }
  return out;
}

/** The ledger with the episodes of queued watches added: Trakt has not got
 * them yet (the queue goes out first, but a send can fail), and taking a
 * tick away only for it to come back a sync later is wrong twice. */
export function withQueued(ledger: Ledger, queue: readonly HistoryBody[]): Ledger {
  const out: Ledger = { ...ledger };
  for (const body of queue)
    for (const show of body.shows ?? []) {
      const id = imdbOf(show.ids.imdb);
      if (!id) continue;
      const have = new Set(out[id] ?? []);
      for (const season of show.seasons)
        for (const e of season.episodes) have.add(episodeId(id, season.number, e.number));
      out[id] = [...have];
    }
  return out;
}

/** Trakt's watched films: IMDb id → when last watched (ms), for the mark on
 * a film's page (D6). */
export function moviesFromTrakt(movies: readonly WatchedMovie[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of movies) {
    const id = m.movie.ids.imdb && imdbOf(m.movie.ids.imdb);
    if (!id) continue;
    const t = m.last_watched_at ? Date.parse(m.last_watched_at) : NaN;
    out[id] = Number.isFinite(t) ? t : 0;
  }
  return out;
}

/**
 * The first sync's one push: episodes ticked here that Trakt does not have,
 * and films finished here that it does not either. `watched_at: "unknown"`
 * for episodes, since the app never kept when an episode ended: Trakt's
 * documented way to mark one watched without inventing a date. Null when
 * there is nothing to send.
 */
export function historyToPush(
  local: Ledger,
  trakt: Ledger,
  localMovies: ReadonlyMap<string, number> = new Map(),
  traktMovies: Record<string, number> = {},
): HistoryBody | null {
  const shows: NonNullable<HistoryBody["shows"]> = [];
  for (const [series, eps] of Object.entries(local)) {
    if (!imdbOf(series)) continue;
    const have = new Set(trakt[series] ?? []);
    const bySeason = new Map<number, number[]>();
    for (const ep of eps) {
      if (have.has(ep)) continue;
      const ref = episodeRef(ep);
      if (!ref || ref.show !== series) continue;
      bySeason.set(ref.season, [...(bySeason.get(ref.season) ?? []), ref.number]);
    }
    if (!bySeason.size) continue;
    shows.push({
      ids: { imdb: series },
      seasons: [...bySeason].map(([number, nums]) => ({
        number,
        episodes: nums.map((n) => ({ number: n, watched_at: "unknown" })),
      })),
    });
  }
  const movies: NonNullable<HistoryBody["movies"]> = [];
  for (const [id, when] of localMovies) {
    if (!imdbOf(id) || id in traktMovies) continue;
    movies.push({ ids: { imdb: id }, watched_at: new Date(when).toISOString() });
  }
  if (!shows.length && !movies.length) return null;
  return { ...(shows.length ? { shows } : {}), ...(movies.length ? { movies } : {}) };
}
