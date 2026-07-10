import {
  fetchCatalog,
  fetchManifest,
  fetchMeta,
  type CatalogDef,
} from "../../data/stremio";
import { load, save } from "../../lib/storage";
import { loadAioUrl } from "../settings/aiostreams";
import { metaPreviewToVod } from "../stream/mapper";
import type { VodItem } from "../stream/model";

/**
 * Discover's data seam: one primary browseable catalog per content type
 * (the grid's feeds), the union of their declared genres (the rail), and
 * skip-paginated fetches that compose with a genre filter — all riding
 * the same Stremio catalog plumbing the Stream tab uses.
 */

export interface DiscoverCatalog {
  type: "movie" | "series";
  id: string;
  /** The catalog's declared genre options, verbatim (opaque strings). */
  genres: string[];
}

export interface DiscoverConfig {
  manifestUrl: string;
  catalogs: DiscoverCatalog[];
  /** Rail order: movie catalog's genres first, series-only ones appended. */
  genres: string[];
}

/** Browseable = fetchable unfiltered: no required extra (search etc.) —
 * the same predicate the Stream tab's rows use. */
const browseable = (cat: CatalogDef): boolean =>
  (cat.extra ?? []).every((e) => !e.isRequired);

const genreOptions = (cat: CatalogDef): string[] =>
  (cat.extra ?? []).find((e) => e.name === "genre")?.options ?? [];

/** EVERY browseable movie/series catalog, manifest order. The rail's
 * genres union across all of them, and each genre's art pulls from a
 * random catalog that declares it — anchoring anything to just the
 * FIRST catalog made an anime-first manifest paint an all-anime
 * Discover. Exported for tests. */
export function pickCatalogs(catalogs: CatalogDef[]): DiscoverCatalog[] {
  return catalogs
    .filter(
      (c): c is CatalogDef & { type: "movie" | "series" } =>
        (c.type === "movie" || c.type === "series") && browseable(c),
    )
    .map((c) => ({ type: c.type, id: c.id, genres: genreOptions(c) }));
}

/** The grid's feeds: EVERY catalog matching the type filter that can
 * serve the current genre — the grid is a conglomerate of all the
 * user's lists (round-robin interleaved, each with its own cursor),
 * not the first catalog wearing filters. Exported for tests. */
export function gridCatalogs(
  catalogs: DiscoverCatalog[],
  filter: "all" | "movie" | "series",
  genre: string | null,
): DiscoverCatalog[] {
  return catalogs.filter(
    (c) => (filter === "all" || c.type === filter) && servesGenre(c, genre),
  );
}

/** Order-preserving, case-insensitive union of the catalogs' genres. */
export function unionGenres(catalogs: DiscoverCatalog[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cat of catalogs)
    for (const g of cat.genres) {
      const k = g.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(g.trim());
    }
  return out;
}

export async function loadDiscover(): Promise<DiscoverConfig> {
  const manifestUrl = loadAioUrl();
  if (!manifestUrl) throw new Error("no addon configured");
  const manifest = await fetchManifest(manifestUrl);
  const catalogs = pickCatalogs(manifest.catalogs ?? []);
  if (catalogs.length === 0)
    throw new Error("the addon declares no browseable catalogs");
  return { manifestUrl, catalogs, genres: unionGenres(catalogs) };
}

/** The Stremio extra path segment for a page: `genre=X&skip=N` (either
 * part optional; undefined when both are). Exported for tests. */
export function catalogExtra(
  genre: string | null,
  skip: number,
): string | undefined {
  const parts: string[] = [];
  if (genre) parts.push(`genre=${encodeURIComponent(genre)}`);
  if (skip > 0) parts.push(`skip=${skip}`);
  return parts.length ? parts.join("&") : undefined;
}

/** Can this catalog serve this genre filter? A catalog that declares
 * genre options can only be asked for one of them; one that declares
 * none can't be genre-filtered at all. */
export function servesGenre(cat: DiscoverCatalog, genre: string | null): boolean {
  if (!genre) return true;
  return cat.genres.some((g) => g.trim().toLowerCase() === genre.toLowerCase());
}

export async function fetchDiscoverPage(
  cfg: DiscoverConfig,
  cat: DiscoverCatalog,
  genre: string | null,
  skip: number,
): Promise<VodItem[]> {
  const res = await fetchCatalog(
    cfg.manifestUrl,
    cat.type,
    cat.id,
    catalogExtra(genre, skip),
  );
  return (res.metas ?? [])
    .filter((m) => m?.id && m?.name)
    .map(metaPreviewToVod);
}

/** Round-robin merge across any number of feeds — the "conglomerate"
 * order: rank-1 of every list, then rank-2 of every list… No cross-
 * catalog ranking exists, so honest interleaving beats a fake one (and
 * beats true randomness: stable under pagination, no reshuffling).
 * Exported for tests. */
export function interleave<T>(...lists: T[][]): T[] {
  const out: T[] = [];
  const n = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < n; i++)
    for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/**
 * Rail wallpapers. Per Adam's spec: every visit, each genre card pulls
 * ONE RANDOM MATCHING TITLE from that genre's own catalog feed and uses
 * its FULL METADATA's backdrop — never sampled from the user's browsed/
 * hero/cached items, so the rail can't inherit the hero sources' taste
 * (the all-anime-rail bug).
 *
 * Each genre's pick is CACHED for 50 hours (Adam: fewer requests beats
 * per-visit churn) — repeat visits inside the window cost zero network,
 * and the redeal crossfades in as the rail's motion. `byId`
 * additionally skips /meta refetches when a redeal draws a title seen
 * before.
 */
const ART_KEY = "discoverArt";
const ART_VERSION = 4; // v4: rotating catalog pick (random pick favored
// whichever flavor dominates the manifest — mostly-anime lists kept
// dealing mostly-anime art)
const ART_ID_CAP = 600;
const ART_TTL_MS = 50 * 3600_000;
interface ArtMemo {
  byId: Record<string, string>;
  lastByGenre: Record<string, { url: string; at: number; n: number }>;
}
let artMem: ArtMemo | null = null;

function artMemo(): ArtMemo {
  artMem ??= load<ArtMemo>(ART_KEY, ART_VERSION, {
    byId: {},
    lastByGenre: {},
  });
  return artMem;
}

function rememberArt(id: string, genre: string, url: string, n: number): void {
  const m = artMemo();
  m.byId[id] = url;
  const keys = Object.keys(m.byId);
  // Cheap cap: drop oldest-inserted keys (object key order) past the cap.
  for (let i = 0; i < keys.length - ART_ID_CAP; i++) delete m.byId[keys[i]];
  m.lastByGenre[genre.toLowerCase()] = { url, at: Date.now(), n };
  save(ART_KEY, ART_VERSION, m);
}

/** djb2 — stable per-genre stagger for the catalog rotation. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The catalog a genre's Nth deal draws from. A RANDOM pick was won by
 * whatever flavor dominates the manifest (five anime lists outvote one
 * general list five rolls to one); rotation guarantees every serving
 * catalog gets its turn, and the per-genre hash stagger spreads the
 * FIRST deal across the whole list so the rail is mixed from day one.
 * Exported for tests. */
export function artCatalogFor(
  serving: DiscoverCatalog[],
  genre: string,
  n: number,
): DiscoverCatalog {
  return serving[(hashStr(genre.toLowerCase()) + n) % serving.length];
}

/** Instant paint: each genre's cached art, whatever its age — staleness
 * only decides whether resolveGenreArt redeals, never blanks a card. */
export function genreArtwork(genres: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const last = artMemo().lastByGenre;
  for (const genre of genres) {
    const hit = last[genre.toLowerCase()];
    if (hit) out.set(genre, hit.url);
  }
  return out;
}

/**
 * The redeal: for every genre whose cached art is missing or older than
 * ART_TTL_MS, fetch its catalog feed (random pick among the catalogs
 * serving it), draw one random title, resolve that title's full
 * metadata, and hand its backdrop over. A few draws per genre, since
 * not every title carries one.
 */
const ART_CONCURRENCY = 4;

export async function resolveGenreArt(
  cfg: DiscoverConfig,
  genres: string[],
  onArt: (genre: string, src: string) => void,
): Promise<void> {
  const dealGenre = async (genre: string) => {
    const cached = artMemo().lastByGenre[genre.toLowerCase()];
    if (cached && Date.now() - cached.at < ART_TTL_MS) return;
    const serving = cfg.catalogs.filter((c) => servesGenre(c, genre));
    if (serving.length === 0) return;
    // Rotation, not randomness (see artCatalogFor). A catalog whose feed
    // yields no usable backdrop advances the rotation and tries the next.
    let n = cached?.n ?? 0;
    for (let hop = 0; hop < Math.min(serving.length, 3); hop++, n++) {
      const cat = artCatalogFor(serving, genre, n);
      const res = await fetchCatalog(
        cfg.manifestUrl,
        cat.type,
        cat.id,
        catalogExtra(genre, 0),
      ).catch(() => null);
      const pool = (res?.metas ?? []).filter((m) => m?.id && m?.name);
      for (let attempt = 0; attempt < 3 && pool.length > 0; attempt++) {
        const [pick] = pool.splice(Math.floor(Math.random() * pool.length), 1);
        const known = artMemo().byId[pick.id];
        const url =
          known ??
          (await fetchMeta(cfg.manifestUrl, cat.type, pick.id)
            .then((r) => r.meta?.background)
            .catch(() => undefined));
        if (url) {
          rememberArt(pick.id, genre, url, n + 1);
          onArt(genre, url);
          return;
        }
      }
    }
  };
  // Small worker pool in rail order: ~40 parallel requests at a slow
  // AIOStreams instance queued the whole tab (the reported slowness) —
  // 4-wide keeps the visible cards landing first and the grid snappy.
  const queue = [...genres];
  await Promise.all(
    Array.from(
      { length: Math.min(ART_CONCURRENCY, queue.length) },
      async () => {
        for (let g = queue.shift(); g !== undefined; g = queue.shift())
          await dealGenre(g);
      },
    ),
  );
}
