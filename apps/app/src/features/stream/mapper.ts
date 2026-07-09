import {
  isSeriesType,
  type MetaDetail,
  type MetaPreview,
  type StremioStream,
  type StremioVideo,
} from "../../data/stremio";
import type { Episode, Season, StreamSource, VodItem } from "./model";

/**
 * Stremio JSON → the Stream tab's domain model. Ported from the old build's
 * `lib/aiostreams/mapper.ts` (battle-tested parsers: bingeGroup resolution,
 * the ⚡ cached marker, "2h49min" runtimes, season-0 "Specials").
 */

// ---------------------------------------------------------------------------
// Streams → sources
// ---------------------------------------------------------------------------

/** HTTP(S)-URL streams only — magnet/infoHash entries are unplayable in mpv
 * without a debrid resolve, which is the addon's job, not ours. Order is
 * preserved: AIOStreams already ranked them. */
export function mapStreams(streams: StremioStream[]): StreamSource[] {
  return streams.filter((s) => isHttp(s.url)).map(mapStream);
}

export function mapStream(s: StremioStream): StreamSource {
  const name = (s.name ?? "").trim();
  const binge = s.behaviorHints?.bingeGroup ?? "";
  return {
    id: hash(s.url ?? s.behaviorHints?.filename ?? name),
    quality: resolutionOf(binge) ?? qualityLabel(name),
    cached: /⚡/u.test(name) || /⚡/u.test(s.description ?? ""),
    lines: sourceLines(s),
    streamUrl: s.url as string,
  };
}

/** Display lines straight from the addon's formatter (its `description`). */
function sourceLines(s: StremioStream): string[] {
  return (s.description ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Meta → VodItem
// ---------------------------------------------------------------------------

/** Full detail (synopsis, cast, seasons). Sources resolve on-demand. */
export function metaToVod(m: MetaDetail): VodItem {
  const kind = isSeriesType(m.type) ? "series" : "movie";
  return {
    id: m.id,
    title: m.name,
    kind,
    year: parseYear(m.year ?? m.releaseInfo),
    poster: httpUrl(m.poster),
    backdrop: httpUrl(m.background) ?? httpUrl(m.landscapePoster),
    logo: httpUrl(m.logo),
    rating: parseRating(m.imdbRating),
    runtimeMin: parseRuntime(m.runtime),
    synopsis: m.description,
    genres: m.genres ?? [],
    cast: castNames(m.cast),
    seasons: kind === "series" ? mapSeasons(m.videos ?? []) : [],
  };
}

/** Lightweight browse-row entry from a catalog preview. */
export function metaPreviewToVod(m: MetaPreview): VodItem {
  return {
    id: m.id,
    title: m.name,
    kind: isSeriesType(m.type) ? "series" : "movie",
    year: parseYear(m.releaseInfo),
    poster: httpUrl(m.poster),
    rating: parseRating(m.imdbRating),
    runtimeMin: parseRuntime(m.runtime),
    synopsis: m.description,
    genres: m.genres ?? [],
    cast: [],
    seasons: [],
  };
}

/** Group a series' flat `videos` list into ordered seasons, dropping
 * unreleased episodes and putting season 0 ("Specials") first. */
export function mapSeasons(videos: StremioVideo[]): Season[] {
  const bySeason = new Map<number, Episode[]>();
  for (const v of videos) {
    if (v.available === false) continue;
    const season = v.season ?? 0;
    const list = bySeason.get(season) ?? [];
    list.push({
      id: v.id,
      number: v.episode ?? list.length + 1,
      title: v.title ?? v.name ?? `Episode ${v.episode}`,
      ...(formatAirDate(v.released) ? { airDate: formatAirDate(v.released) } : {}),
      ...(httpUrl(v.thumbnail) ? { still: httpUrl(v.thumbnail) } : {}),
    });
    bySeason.set(season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, episodes]) => ({
      id: `s${number}`,
      number,
      name: number === 0 ? "Specials" : `Season ${number}`,
      episodes: episodes.sort((a, b) => a.number - b.number),
    }));
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** bingeGroup is `provider|resolution|codec…` — index 1 when it's a real
 * resolution token. */
function resolutionOf(binge: string): string | undefined {
  const res = binge.split("|")[1]?.trim();
  return res && /^\d{3,4}p$/i.test(res) ? res.toLowerCase() : undefined;
}

function qualityLabel(name: string): string {
  const n = name.replace(/⚡/gu, "").trim();
  const m = /(\d{3,4}p)/i.exec(n);
  if (m) return m[1].toLowerCase();
  if (/\b(4k|uhd|2160)\b/i.test(n)) return "2160p";
  return n || "SD";
}

function parseYear(v?: string | number): number | undefined {
  if (v == null) return undefined;
  const m = /(\d{4})/.exec(String(v));
  return m ? Number(m[1]) : undefined;
}

function parseRating(v?: string | number): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** "2h49min" → 169, "58min" → 58. */
function parseRuntime(v?: string): number | undefined {
  if (!v) return undefined;
  const h = /(\d+)\s*h/i.exec(v);
  const min = /(\d+)\s*min/i.exec(v);
  const total = (h ? Number(h[1]) * 60 : 0) + (min ? Number(min[1]) : 0);
  return total > 0 ? total : undefined;
}

function castNames(cast: MetaDetail["cast"]): string[] {
  if (!cast) return [];
  return cast
    .map((c) => (typeof c === "string" ? c : c?.name))
    .filter((n): n is string => Boolean(n))
    .slice(0, 20);
}

/** ISO date → "Jan 21, 2008". */
function formatAirDate(released?: string | null): string | undefined {
  if (!released) return undefined;
  const t = Date.parse(released);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isHttp(s?: string | null): boolean {
  return httpUrl(s) !== undefined;
}

function httpUrl(s?: string | null): string | undefined {
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

/** Small stable hash → a compact id for a source row. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
