import type { Episode, Season, StreamSource, VodItem } from "@blammytv/shared";
import type { MetaDetail, MetaPreview, Stream, Video } from "./types";

// ---------------------------------------------------------------------------
// Streams → ranked sources
// ---------------------------------------------------------------------------

export function mapStreams(streams: Stream[]): StreamSource[] {
  return streams.filter((s) => isHttp(s.url)).map(mapStream);
}

export function mapStream(s: Stream): StreamSource {
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

/** The source's display lines, taken straight from AIOStreams' formatter (its
 * `description`) — formatter-agnostic, same as Stremio. */
function sourceLines(s: Stream): string[] {
  return (s.description ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Meta → VodItem
// ---------------------------------------------------------------------------

/** Full detail (synopsis, cast, seasons). Sources are resolved on-demand. */
export function metaToVod(m: MetaDetail): VodItem {
  const kind = isSeries(m.type) ? "series" : "movie";
  return {
    id: m.id,
    title: m.name,
    year: parseYear(m.year ?? m.releaseInfo),
    poster: httpUrl(m.poster),
    backdrop: httpUrl(m.background) ?? httpUrl(m.landscapePoster),
    logo: httpUrl(m.logo),
    kind,
    rating: parseRating(m.imdbRating),
    runtimeMin: parseRuntime(m.runtime),
    synopsis: m.description,
    genres: m.genres ?? [],
    cast: castNames(m.cast),
    sources: [],
    seasons: kind === "series" ? mapSeasons(m.videos ?? []) : [],
  };
}

/** Lightweight browse-grid entry from a catalog preview. */
export function metaPreviewToVod(m: MetaPreview): VodItem {
  return {
    id: m.id,
    title: m.name,
    year: parseYear(m.releaseInfo),
    poster: httpUrl(m.poster),
    kind: isSeries(m.type) ? "series" : "movie",
    rating: parseRating(m.imdbRating),
    synopsis: m.description,
    genres: m.genres ?? [],
    cast: [],
    sources: [],
    seasons: [],
  };
}

/** Group a series' flat `videos` list into ordered seasons, dropping
 * unreleased episodes and putting season 0 ("Specials") first. */
export function mapSeasons(videos: Video[]): Season[] {
  const bySeason = new Map<number, Episode[]>();
  for (const v of videos) {
    if (v.available === false) continue;
    const season = v.season ?? 0;
    const list = bySeason.get(season) ?? [];
    list.push({
      id: v.id,
      number: v.episode ?? list.length + 1,
      title: v.title ?? v.name ?? `Episode ${v.episode}`,
      airDate: formatAirDate(v.released),
      still: httpUrl(v.thumbnail),
      sources: [],
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

/** Stremio types can be "series" or "anime.series" etc. */
export function isSeries(type?: string): boolean {
  return (type ?? "").includes("series");
}

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

/** "2h49min" → 169, "58min" → 58, "3min" → 3. */
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
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
