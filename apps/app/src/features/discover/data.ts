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

/** First browseable catalog per content type. Exported for tests. */
export function pickCatalogs(catalogs: CatalogDef[]): DiscoverCatalog[] {
  const out: DiscoverCatalog[] = [];
  for (const type of ["movie", "series"] as const) {
    const cat = catalogs.find((c) => c.type === type && browseable(c));
    if (cat) out.push({ type, id: cat.id, genres: genreOptions(cat) });
  }
  return out;
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

/** Alternate merge for the "All Content" grid — no cross-type ranking
 * exists, so honest interleaving beats a fake one. Exported for tests. */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
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
const ART_VERSION = 2; // v2: genre-feed sourced; v1 sampled browse items
const ART_ID_CAP = 600;
const ART_TTL_MS = 50 * 3600_000;
interface ArtMemo {
  byId: Record<string, string>;
  lastByGenre: Record<string, { url: string; at: number }>;
}
let artMem: ArtMemo | null = null;

function artMemo(): ArtMemo {
  artMem ??= load<ArtMemo>(ART_KEY, ART_VERSION, {
    byId: {},
    lastByGenre: {},
  });
  return artMem;
}

function rememberArt(id: string, genre: string, url: string): void {
  const m = artMemo();
  m.byId[id] = url;
  const keys = Object.keys(m.byId);
  // Cheap cap: drop oldest-inserted keys (object key order) past the cap.
  for (let i = 0; i < keys.length - ART_ID_CAP; i++) delete m.byId[keys[i]];
  m.lastByGenre[genre.toLowerCase()] = { url, at: Date.now() };
  save(ART_KEY, ART_VERSION, m);
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
export async function resolveGenreArt(
  cfg: DiscoverConfig,
  genres: string[],
  onArt: (genre: string, src: string) => void,
): Promise<void> {
  await Promise.all(
    genres.map(async (genre) => {
      const cached = artMemo().lastByGenre[genre.toLowerCase()];
      if (cached && Date.now() - cached.at < ART_TTL_MS) return;
      const serving = cfg.catalogs.filter((c) => servesGenre(c, genre));
      if (serving.length === 0) return;
      const cat = serving[Math.floor(Math.random() * serving.length)];
      const res = await fetchCatalog(
        cfg.manifestUrl,
        cat.type,
        cat.id,
        catalogExtra(genre, 0),
      ).catch(() => null);
      const pool = (res?.metas ?? []).filter((m) => m?.id && m?.name);
      for (let attempt = 0; attempt < 3 && pool.length > 0; attempt++) {
        const [pick] = pool.splice(
          Math.floor(Math.random() * pool.length),
          1,
        );
        const known = artMemo().byId[pick.id];
        const url =
          known ??
          (await fetchMeta(cfg.manifestUrl, cat.type, pick.id)
            .then((r) => r.meta?.background)
            .catch(() => undefined));
        if (url) {
          rememberArt(pick.id, genre, url);
          onArt(genre, url);
          return;
        }
      }
    }),
  );
}
