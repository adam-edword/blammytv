import { httpGetJson } from "../../lib/http";
import { load, save } from "../../lib/storage";
import type { Season, VodItem } from "./model";

/**
 * Where an anime episode is on MyAnimeList. Two things need it: AniSkip's
 * skip times (aniskip.ts, keyed by MAL id + MAL episode number) and the MAL
 * list sync (features/mal, plan 021). Our content is IMDb-keyed (tt… +
 * season/episode), so the bridge is Fribb/anime-lists — a weekly-updated
 * dataset merging anime-offline-database with the Anime-Lists TVDB/IMDb
 * mappings. Each dataset row is one MAL entry; multi-season shows repeat
 * the IMDb id across rows with `season.tvdb` marking which season a row
 * is, and `episode_offset.tvdb` marking where a split-cour entry starts
 * inside that season (Attack on Titan S3 is mal 35760 from E1 and mal
 * 38524 from E13). Long-runners like One Piece are a single row with NO
 * season field — MAL numbers them absolutely.
 *
 * Titles from the Kitsu anime addon are keyed `kitsu:ID`, episodes
 * `kitsu:ID:N` (its source: season 1, episode N). A Kitsu entry is one MAL
 * entry (19,958 pairs in the dataset, none conflicting), so the episode
 * number carries over as it is (plan 021, D6).
 *
 * Everything here fails soft: no index or no mapping is a null, and each
 * caller does without.
 */

/** [mal id, tvdb season (null = MAL-absolute entry), episode offset, type] */
export type IndexRow = [number, number | null, number, string];
export type SlimIndex = Record<string, IndexRow[]>;
/** Kitsu id → MAL id. */
export type KitsuIndex = Record<string, number>;

const DATASET_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";
const INDEX_KEY = "aniskipIndex";
const INDEX_VERSION = 1;
const KITSU_KEY = "kitsuMalIndex";
const KITSU_VERSION = 1;
const INDEX_MAX_AGE_MS = 7 * 24 * 3600_000; // the dataset updates weekly

/** One row of the upstream dataset — only the fields we consume. */
export interface DatasetEntry {
  imdb_id?: string | string[];
  kitsu_id?: number;
  mal_id?: number;
  type?: string;
  season?: { tvdb?: number };
  episode_offset?: { tvdb?: number };
}

/** Build the imdb-keyed slim index from the raw dataset. Exported for
 * tests; ~8k of the 39k rows carry an imdb id, and the result is ~230KB
 * of JSON — small enough for localStorage. */
export function buildIndex(entries: DatasetEntry[]): SlimIndex {
  const map: SlimIndex = {};
  for (const e of entries) {
    if (!e.mal_id || !e.imdb_id) continue;
    const ids = Array.isArray(e.imdb_id) ? e.imdb_id : [e.imdb_id];
    const row: IndexRow = [
      e.mal_id,
      e.season?.tvdb ?? null,
      e.episode_offset?.tvdb ?? 0,
      e.type ?? "",
    ];
    for (const id of ids) (map[id] ??= []).push(row);
  }
  return map;
}

/** Kitsu id → MAL id, ~260KB of JSON. Only built into storage for someone
 * whose titles are Kitsu-keyed. */
export function buildKitsuIndex(entries: DatasetEntry[]): KitsuIndex {
  const map: KitsuIndex = {};
  for (const e of entries) if (e.kitsu_id && e.mal_id) map[e.kitsu_id] = e.mal_id;
  return map;
}

/** Anime detection heuristic: every anime catalog tags Animation — so a
 * non-matching item never even downloads the mapping dataset. */
export function looksAnime(item: Pick<VodItem, "genres">): boolean {
  return item.genres.some((g) => /anim/i.test(g));
}

let dataset: Promise<{ imdb: SlimIndex; kitsu: KitsuIndex } | null> | null = null;

/** The ~6MB dataset, once a session at most, built into both indexes. A
 * failed fetch retries next session (the memo is per-session only). */
function fetchDataset() {
  dataset ??= httpGetJson<DatasetEntry[]>(DATASET_URL).then(
    (raw) => ({ imdb: buildIndex(raw), kitsu: buildKitsuIndex(raw) }),
    (err) => {
      console.warn(`[anime] mapping dataset fetch failed: ${String(err)}`);
      return null;
    },
  );
  return dataset;
}

function cachedOrFetched<T>(
  key: string,
  version: number,
  pick: (d: { imdb: SlimIndex; kitsu: KitsuIndex }) => T,
): Promise<T | null> {
  const cached = load<{ at: number; map: T } | null>(key, version, null);
  if (cached && Date.now() - cached.at < INDEX_MAX_AGE_MS)
    return Promise.resolve(cached.map);
  return fetchDataset().then((d) => {
    // A stale cache beats nothing.
    if (!d) return cached?.map ?? null;
    const map = pick(d);
    save(key, version, { at: Date.now(), map });
    console.info(`[anime] ${key} refreshed: ${Object.keys(map as object).length} ids`);
    return map;
  });
}

let imdbPromise: Promise<SlimIndex | null> | null = null;
let kitsuPromise: Promise<KitsuIndex | null> | null = null;

/** The cached IMDb index, refreshed weekly. Lazy: the first anime that
 * needs it pays the one download, everyone else never fetches. */
export function ensureIndex(): Promise<SlimIndex | null> {
  imdbPromise ??= cachedOrFetched(INDEX_KEY, INDEX_VERSION, (d) => d.imdb);
  return imdbPromise;
}

/** The cached Kitsu index, the same way, for Kitsu-keyed titles only. */
export function ensureKitsuIndex(): Promise<KitsuIndex | null> {
  kitsuPromise ??= cachedOrFetched(KITSU_KEY, KITSU_VERSION, (d) => d.kitsu);
  return kitsuPromise;
}

/**
 * imdb + S/E → the MAL entry + MAL-relative episode number.
 *
 * Season rows win when one matches (largest offset below the episode —
 * that picks the right split-cour half). A lone season-less TV row is
 * the MAL-absolute case: the episode's 1-based position across all
 * non-special seasons IS its MAL number (robust whether the catalog
 * numbers episodes per-season or absolutely, as long as the list is
 * complete — One Piece "S21 E1071" sits at position 1071 either way).
 *
 * `strict` is for a write to someone's MAL list (plan 021, D5): when two
 * rows share the season and offset (a TV entry and an OVA, say), the TV
 * one is taken when it is the only TV one, and otherwise nothing is.
 * Skip times take the first row, as they always have.
 */
export function resolveMal(
  rows: IndexRow[],
  season: number | null,
  episode: number | null,
  episodeId: string | null,
  seasons: Season[],
  strict = false,
): { mal: number; ep: number } | null {
  if (season == null || episode == null) {
    // Movie: exactly one movie-typed row, episode 1.
    const movies = rows.filter(([, , , t]) => t === "MOVIE");
    return movies.length === 1 ? { mal: movies[0][0], ep: 1 } : null;
  }
  const inSeason = rows.filter(([, s]) => s === season);
  if (inSeason.length > 0) {
    let best: IndexRow | null = null;
    for (const r of inSeason)
      if (r[2] < episode && (!best || r[2] > best[2])) best = r;
    if (!best) return null;
    if (strict) {
      const offset = best[2];
      const tied = inSeason.filter((r) => r[2] === offset);
      if (tied.length > 1) {
        const tv = tied.filter((r) => r[3] === "TV");
        if (tv.length !== 1) return null;
        best = tv[0];
      }
    }
    return { mal: best[0], ep: episode - best[2] };
  }
  const absolute = rows.filter(([, s, , t]) => s === null && t === "TV");
  if (absolute.length === 1 && episodeId) {
    const ep = absoluteEpisode(seasons, episodeId);
    return ep ? { mal: absolute[0][0], ep } : null;
  }
  return null;
}

/** 1-based position of an episode across all non-special seasons. */
export function absoluteEpisode(
  seasons: Season[],
  episodeId: string,
): number | null {
  let n = 0;
  for (const s of [...seasons].sort((a, b) => a.number - b.number)) {
    if (s.number === 0) continue;
    for (const e of s.episodes) {
      n++;
      if (e.id === episodeId) return n;
    }
  }
  return null;
}

export interface AnimeIndexes {
  imdb: SlimIndex | null;
  kitsu: KitsuIndex | null;
}

/**
 * Where a series episode lands on MAL, for a write (plan 021): an
 * IMDb-keyed one through the season rows under the strict rule, a
 * Kitsu-keyed one straight across. Null when it can't be placed for
 * certain.
 */
export function malEpisodeOf(
  seriesId: string,
  episodeId: string,
  seasons: Season[],
  idx: AnimeIndexes,
): { mal: number; ep: number } | null {
  const kitsu = /^kitsu:(\d+)$/.exec(seriesId);
  if (kitsu) {
    const mal = idx.kitsu?.[kitsu[1]];
    if (!mal) return null;
    // A one-video entry (an OVA, a special) plays as `kitsu:ID` itself.
    if (episodeId === seriesId) return { mal, ep: 1 };
    const m = /^kitsu:\d+(?::\d+)*:(\d+)$/.exec(episodeId);
    return m && episodeId.startsWith(`${seriesId}:`) ? { mal, ep: Number(m[1]) } : null;
  }
  const rows = idx.imdb?.[seriesId];
  if (!rows?.length) return null;
  const m = /^.+:(\d+):(\d+)$/.exec(episodeId);
  if (!m) return null;
  return resolveMal(rows, Number(m[1]), Number(m[2]), episodeId, seasons, true);
}

/**
 * The episodes of a series that MAL counts as watched (plan 021, D2 b):
 * every episode whose MAL entry's count reaches it. The same mapping as a
 * write, run backwards, so what goes out and what comes back agree.
 * `counts` is MAL id → episodes watched.
 */
export function malWatchedEpisodes(
  seriesId: string,
  seasons: Season[],
  idx: AnimeIndexes,
  counts: ReadonlyMap<number, number>,
): string[] {
  const out: string[] = [];
  for (const s of seasons)
    for (const e of s.episodes) {
      const hit = malEpisodeOf(seriesId, e.id, seasons, idx);
      if (hit && (counts.get(hit.mal) ?? 0) >= hit.ep) out.push(e.id);
    }
  return out;
}
