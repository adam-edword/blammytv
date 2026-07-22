import { httpGetJson } from "../../lib/http";
import { load, save } from "../../lib/storage";
import type { Season, VodItem } from "./model";

/**
 * Skip Intro Phase 2: exact opening/ending intervals from the AniSkip
 * community API (api.aniskip.com), which is keyed by MyAnimeList id +
 * MAL episode number. Our content is IMDb-keyed (tt… + season/episode),
 * so the bridge is Fribb/anime-lists — a weekly-updated dataset merging
 * anime-offline-database with the Anime-Lists TVDB/IMDb mappings. Each
 * dataset row is one MAL entry; multi-season shows repeat the IMDb id
 * across rows with `season.tvdb` marking which season a row is, and
 * `episode_offset.tvdb` marking where a split-cour entry starts inside
 * that season (Attack on Titan S3 is mal 35760 from E1 and mal 38524
 * from E13). Long-runners like One Piece are a single row with NO
 * season field — MAL numbers them absolutely.
 *
 * Everything here fails soft: no index, no mapping, no AniSkip data, or
 * a dead API all degrade to Phase 1 (mpv chapter heuristics) silently.
 */

export interface SkipRange {
  /** AniSkip skip type: op | ed | mixed-op | mixed-ed | recap. */
  type: string;
  /** Seconds from episode start. */
  start: number;
  end: number;
}

/** [mal id, tvdb season (null = MAL-absolute entry), episode offset, type] */
type IndexRow = [number, number | null, number, string];
type SlimIndex = Record<string, IndexRow[]>;

const DATASET_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";
const INDEX_KEY = "aniskipIndex";
const INDEX_VERSION = 1;
const INDEX_MAX_AGE_MS = 7 * 24 * 3600_000; // the dataset updates weekly

const API_BASE = "https://api.aniskip.com/v2/skip-times";
const API_TYPES = "types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap";

/** One row of the upstream dataset — only the fields we consume. */
interface DatasetEntry {
  imdb_id?: string | string[];
  mal_id?: number;
  type?: string;
  season?: { tvdb?: number };
  episode_offset?: { tvdb?: number };
}

interface AniskipResponse {
  found?: boolean;
  results?: Array<{
    interval?: { startTime?: number; endTime?: number };
    skipType?: string;
  }>;
}

/** Build the imdb-keyed slim index from the raw dataset. Exported for
 * tests; ~8k of the 43k rows carry an imdb id, and the result is ~250KB
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

/** Anime detection heuristic: AniSkip only has anime, and every anime
 * catalog tags Animation — so a non-matching item never even downloads
 * the mapping dataset. */
export function looksAnime(item: Pick<VodItem, "genres">): boolean {
  return item.genres.some((g) => /anim/i.test(g));
}

let indexPromise: Promise<SlimIndex | null> | null = null;

/** The cached slim index, refreshed weekly. Lazy: first anime playback
 * pays the one ~6MB dataset download, everyone else never fetches. */
function ensureIndex(): Promise<SlimIndex | null> {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const cached = load<{ at: number; map: SlimIndex } | null>(
      INDEX_KEY,
      INDEX_VERSION,
      null,
    );
    if (cached && Date.now() - cached.at < INDEX_MAX_AGE_MS) return cached.map;
    try {
      const raw = await httpGetJson<DatasetEntry[]>(DATASET_URL);
      const map = buildIndex(raw);
      save(INDEX_KEY, INDEX_VERSION, { at: Date.now(), map });
      console.info(
        `[aniskip] mapping index refreshed: ${Object.keys(map).length} imdb ids`,
      );
      return map;
    } catch (err) {
      console.warn(`[aniskip] mapping dataset fetch failed: ${String(err)}`);
      // A stale cache beats nothing; a failed first fetch retries next
      // session (the in-flight promise memo is per-session only).
      return cached?.map ?? null;
    }
  })();
  return indexPromise;
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
 */
export function resolveMal(
  rows: IndexRow[],
  season: number | null,
  episode: number | null,
  episodeId: string | null,
  seasons: Season[],
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
    return best ? { mal: best[0], ep: episode - best[2] } : null;
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

/** Session cache incl. negative results — one API round-trip per episode. */
const skipCache = new Map<string, SkipRange[]>();

async function fetchSkips(mal: number, ep: number): Promise<SkipRange[]> {
  const key = `${mal}:${ep}`;
  const hit = skipCache.get(key);
  if (hit) return hit;
  let ranges: SkipRange[] = [];
  try {
    // episodeLength=0 disables the server's length matching — we query at
    // play start, before the file's real duration is known.
    const res = await httpGetJson<AniskipResponse>(
      `${API_BASE}/${mal}/${ep}?${API_TYPES}&episodeLength=0`,
    );
    ranges = (res.results ?? [])
      .map((r) => ({
        type: r.skipType ?? "",
        start: r.interval?.startTime ?? 0,
        end: r.interval?.endTime ?? 0,
      }))
      .filter((r) => r.end > r.start);
  } catch (err) {
    // 404 is AniSkip's "no data for this episode" — expected, cache it.
    if (!/HTTP 404/.test(String(err))) {
      console.warn(`[aniskip] query failed for mal ${mal} ep ${ep}: ${String(err)}`);
      return []; // transient failure: uncached so a retry can succeed
    }
  }
  skipCache.set(key, ranges);
  return ranges;
}

/**
 * The one entry point: exact skip ranges for what's about to play, or []
 * when anything along the chain has no answer. `episodeId` is the Stremio
 * id ("tt…:S:E"); null for movies.
 */
export async function getAniskipRanges(
  item: VodItem,
  episodeId: string | null | undefined,
): Promise<SkipRange[]> {
  if (!looksAnime(item)) return [];
  const index = await ensureIndex();
  const rows = index?.[item.id];
  if (!rows?.length) return [];
  let season: number | null = null;
  let episode: number | null = null;
  if (episodeId) {
    const m = /^.+:(\d+):(\d+)$/.exec(episodeId);
    if (!m) return [];
    season = Number(m[1]);
    episode = Number(m[2]);
  }
  const hit = resolveMal(rows, season, episode, episodeId ?? null, item.seasons);
  if (!hit) return [];
  const ranges = await fetchSkips(hit.mal, hit.ep);
  if (ranges.length)
    console.info(
      `[aniskip] mal ${hit.mal} ep ${hit.ep}: ${ranges.map((r) => r.type).join(", ")}`,
    );
  return ranges;
}
