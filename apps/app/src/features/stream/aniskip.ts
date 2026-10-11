import { httpGetJson } from "../../lib/http";
import { ensureIndex, ensureKitsuIndex, looksAnime, malEpisodeOf, malFilmOf, resolveMal } from "./animemap";
import type { VodItem } from "./model";

/**
 * Skip Intro Phase 2: exact opening/ending intervals from the AniSkip
 * community API (api.aniskip.com), which is keyed by MyAnimeList id +
 * MAL episode number, reached through animemap.ts (Fribb/anime-lists).
 *
 * Everything here fails soft: no index, no mapping, no AniSkip data, or
 * a dead API all degrade to Phase 1 (mpv chapter heuristics) silently.
 */

export interface SkipRange {
  /** AniSkip skip type: op | ed | mixed-op | mixed-ed | recap. AIOStreams'
   * markers (rules.ts skipsFrom) add preview. */
  type: string;
  /** Seconds from episode start. */
  start: number;
  end: number;
}

const API_BASE = "https://api.aniskip.com/v2/skip-times";
const API_TYPES = "types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap";

interface AniskipResponse {
  found?: boolean;
  results?: Array<{
    interval?: { startTime?: number; endTime?: number };
    skipType?: string;
  }>;
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

/** Where what's about to play is on MAL: an IMDb-keyed title through the
 * season rows (skip times take the first row, as they always have), a
 * Kitsu-keyed one the way MAL's own writes place it, straight across. */
async function malPlace(
  item: VodItem,
  episodeId: string | null | undefined,
): Promise<{ mal: number; ep: number } | null> {
  if (/^kitsu:\d+$/.test(item.id)) {
    // Anime by where it comes from, so no genre gate (animemap.ts, and MAL's
    // indexesFor, skip it too): the Kitsu addon's genres don't say
    // Animation. Its index is MAL's own, not the IMDb one below.
    const kitsu = await ensureKitsuIndex();
    if (!kitsu) return null;
    const idx = { imdb: null, kitsu };
    return episodeId ? malEpisodeOf(item.id, episodeId, item.seasons, idx) : malFilmOf(item.id, idx);
  }
  if (!looksAnime(item)) return null;
  const index = await ensureIndex();
  const rows = index?.[item.id];
  if (!rows?.length) return null;
  let season: number | null = null;
  let episode: number | null = null;
  if (episodeId) {
    const m = /^.+:(\d+):(\d+)$/.exec(episodeId);
    if (!m) return null;
    season = Number(m[1]);
    episode = Number(m[2]);
  }
  return resolveMal(rows, season, episode, episodeId ?? null, item.seasons);
}

/**
 * The one entry point: exact skip ranges for what's about to play, or []
 * when anything along the chain has no answer. `episodeId` is the Stremio
 * id ("tt…:S:E", "kitsu:ID:N"); null for movies.
 */
export async function getAniskipRanges(
  item: VodItem,
  episodeId: string | null | undefined,
): Promise<SkipRange[]> {
  const hit = await malPlace(item, episodeId);
  if (!hit) return [];
  const ranges = await fetchSkips(hit.mal, hit.ep);
  if (ranges.length)
    console.info(
      `[aniskip] mal ${hit.mal} ep ${hit.ep}: ${ranges.map((r) => r.type).join(", ")}`,
    );
  return ranges;
}
