import {
  fetchCatalog,
  fetchManifest,
  type CatalogDef,
} from "../../data/stremio";
import { load, save } from "../../lib/storage";
import { loadAioUrl } from "../settings/aiostreams";
import { metaPreviewToVod } from "../stream/mapper";
import type { VodItem } from "../stream/model";
import { loadVod, peekVod, resolveVodItem } from "../stream/source";

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
 * Rail wallpapers, dealt fresh each visit: a random backdrop per genre.
 *
 * Catalog PREVIEWS carry no backdrop — only hero-enriched items do, and
 * the hero pool follows the user's hero sources (all-anime hero = an
 * all-anime rail, the reported bug). So backdrops learned from full-meta
 * fetches are remembered here (id → url), which widens the pool to any
 * item the rail has ever resolved: the sync pass paints instantly from
 * known art, and resolveGenreArt backfills the gaps.
 */
const ART_KEY = "discoverArt";
const ART_VERSION = 1;
const ART_CAP = 600;
let artMem: Record<string, string> | null = null;

function artCache(): Record<string, string> {
  artMem ??= load<Record<string, string>>(ART_KEY, ART_VERSION, {});
  return artMem;
}

function rememberArt(id: string, url: string): void {
  const c = artCache();
  if (c[id] === url) return;
  c[id] = url;
  const keys = Object.keys(c);
  // Cheap cap: drop oldest-inserted keys (object key order) past the cap.
  for (let i = 0; i < keys.length - ART_CAP; i++) delete c[keys[i]];
  save(ART_KEY, ART_VERSION, c);
}

const backdropOf = (i: VodItem): string | undefined =>
  i.backdrop ?? artCache()[i.id];

const genreMatches = (pool: VodItem[], genre: string): VodItem[] => {
  const k = genre.toLowerCase();
  return pool.filter((i) => i.genres.some((g) => g.toLowerCase() === k));
};

export function genreArtwork(genres: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const data = peekVod();
  if (!data) return out;
  const pool = [...data.items.values()];
  for (const genre of genres) {
    const withArt = genreMatches(pool, genre).filter(backdropOf);
    if (withArt.length) {
      const pick = withArt[Math.floor(Math.random() * withArt.length)];
      out.set(genre, backdropOf(pick) as string);
    }
  }
  return out;
}

/**
 * Backfill wallpapers for genres the sync pass couldn't cover: pick a
 * random cached item of the genre and resolve its FULL meta (which does
 * carry `background`), remembering the result so future visits paint it
 * synchronously — the cache broadens with every genre the rail shows.
 * One tiny /meta call per uncovered genre, once per install (then cached).
 */
export async function resolveGenreArt(
  genres: string[],
  onArt: (genre: string, src: string) => void,
): Promise<void> {
  // Discover can be the FIRST tab visited: the item cache is empty until
  // the Stream catalog builds, so build it (disk-hydrated when possible)
  // rather than leaving the rail artless until a Stream visit.
  const data = peekVod() ?? (await loadVod().catch(() => null));
  if (!data) return;
  const pool = [...data.items.values()];
  await Promise.all(
    genres.map(async (genre) => {
      const matches = genreMatches(pool, genre).filter((i) => !backdropOf(i));
      // A few tries: not every title's full meta carries a backdrop.
      for (let attempt = 0; attempt < 2 && matches.length > 0; attempt++) {
        const idx = Math.floor(Math.random() * matches.length);
        const [pick] = matches.splice(idx, 1);
        const full = await resolveVodItem(pick.kind, pick.id).catch(() => null);
        if (full?.backdrop) {
          rememberArt(pick.id, full.backdrop);
          onArt(genre, full.backdrop);
          return;
        }
      }
    }),
  );
}
