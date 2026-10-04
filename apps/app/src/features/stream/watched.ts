import { load, remove, save } from "../../lib/storage";

/** Per-series watched-episode ledger — powers the checkmarks in the
 * episode grid. An episode is marked when it plays to its natural end.
 * Capped per series so a long-running anime can't grow unbounded. */

const KEY = "watchedEpisodes";
const VERSION = 1;
/** Trakt's sync writes a long show whole (replaceLedger), and the next
 * local mark trims to this. At 600 that cut the oldest ticks of anything
 * longer (One Piece and Detective Conan are past 1,100) and "next up" fell
 * back to episode 1. 5,000 is well past any show. */
const CAP_PER_SERIES = 5000;
/** Episodes MyAnimeList counts as watched (plan 021, D2 b), kept apart from
 * the ledger: Trakt replaces the ledger's IMDb series on every sync, and
 * MAL's ticks must survive that (D3, a tick from either counts). */
const MAL_KEY = "malWatched";
/** What AIOStreams counts as played (plan 023, D3), apart from the ledger for
 * the same reason as MAL's: Trakt replaces the ledger's IMDb series on every
 * sync. Replaced whole on each AIOStreams sync, so un-marking in another of
 * its apps un-ticks here too. Episodes by series, and the films. */
const AIO_KEY = "aioWatched";

type WatchedMap = Record<string, string[]>;

export interface AioPlayed {
  episodes: WatchedMap;
  films: string[];
}

export function loadAioWatched(): AioPlayed {
  const v = load<Partial<AioPlayed>>(AIO_KEY, VERSION, {});
  return { episodes: v.episodes ?? {}, films: v.films ?? [] };
}

/** A tick shows if any store has it: yours, Trakt's (the ledger), MAL's or
 * AIOStreams' (D3). */
export function loadWatched(seriesId: string): Set<string> {
  const map = load<WatchedMap>(KEY, VERSION, {});
  const mal = load<WatchedMap>(MAL_KEY, VERSION, {});
  const aio = loadAioWatched().episodes;
  return new Set([...(map[seriesId] ?? []), ...(mal[seriesId] ?? []), ...(aio[seriesId] ?? [])]);
}

/** AIOStreams' played list, in place of the last one. True when it changed. */
export function replaceAioWatched(next: AioPlayed): boolean {
  const before = JSON.stringify(loadAioWatched());
  if (before === JSON.stringify(next)) return false;
  save(AIO_KEY, VERSION, next);
  return true;
}

/** AIOStreams disconnected: its ticks go with it. */
export function forgetAioWatched(): void {
  remove(AIO_KEY);
}

/** MAL's ticks for one series. True when they changed. */
export function setMalWatched(seriesId: string, episodeIds: string[]): boolean {
  const map = load<WatchedMap>(MAL_KEY, VERSION, {});
  const before = map[seriesId] ?? [];
  if (before.length === episodeIds.length && before.every((id, i) => id === episodeIds[i])) return false;
  if (episodeIds.length) map[seriesId] = episodeIds;
  else delete map[seriesId];
  save(MAL_KEY, VERSION, map);
  return true;
}

/** MAL disconnected: its ticks go with it. */
export function forgetMalWatched(): void {
  remove(MAL_KEY);
}

/** Said whenever an episode counts as watched here, with
 * `{ seriesId, episodeId }`: at its end, 90% through, or when Trakt counts
 * it. Every time, a repeat included; a listener dedupes. */
export const EPISODE_WATCHED = "blammytv:episode-watched";

/** The whole ledger, series id → watched episode ids. */
export function loadLedger(): WatchedMap {
  return load<WatchedMap>(KEY, VERSION, {});
}

/** Trakt is the ledger once connected (plan 015, D3): its answer replaces
 * every IMDb-keyed series here. Series keyed by anything else (Kitsu) are
 * not on Trakt at all, so their ticks stay as they are. */
export function replaceLedger(fromTrakt: WatchedMap): void {
  const kept = Object.fromEntries(
    Object.entries(loadLedger()).filter(([id]) => !/^tt\d+$/.test(id)),
  );
  save(KEY, VERSION, { ...kept, ...fromTrakt });
}

/** Said whenever a film counts as watched here, with `{ filmId }`: 90%
 * through, at its end, or when Trakt counts it. Films have no ledger of
 * their own; this is for MyAnimeList (plan 021). Every time, a repeat
 * included; a listener dedupes. */
export const FILM_WATCHED = "blammytv:film-watched";

export function filmWatched(filmId: string): void {
  window.dispatchEvent(new CustomEvent(FILM_WATCHED, { detail: { filmId } }));
}

export function markWatched(seriesId: string, episodeId: string): void {
  const map = load<WatchedMap>(KEY, VERSION, {});
  const list = map[seriesId] ?? [];
  if (!list.includes(episodeId)) {
    map[seriesId] = [...list, episodeId].slice(-CAP_PER_SERIES);
    save(KEY, VERSION, map);
  }
  window.dispatchEvent(new CustomEvent(EPISODE_WATCHED, { detail: { seriesId, episodeId } }));
}
