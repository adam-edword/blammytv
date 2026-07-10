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
import { peekVod } from "../stream/source";

/**
 * Discover's data seam: one primary browseable catalog per content type
 * (the grid's feeds), the union of their declared genres (the rail), and
 * skip-paginated fetches that compose with a genre filter — all riding
 * the same Stremio catalog plumbing the Stream tab uses.
 */

export interface DiscoverCatalog {
  type: "movie" | "series";
  id: string;
  /** The catalog declares a genre extra at all (options or not). */
  genreCapable: boolean;
  /** The catalog's declared genre OPTIONS, verbatim (opaque strings).
   * Empty with genreCapable=true means "takes a genre, enumerates
   * nothing" — such catalogs serve ANY genre filter. */
  genres: string[];
}

export interface DiscoverConfig {
  manifestUrl: string;
  catalogs: DiscoverCatalog[];
  /** Rail order: movie catalog's genres first, series-only ones appended. */
  genres: string[];
  /** Catalogs declaring a `search` extra (search-only ones included —
   * they're excluded from browse but are exactly what search wants). */
  searchCatalogs: DiscoverCatalog[];
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
    .map((c) => ({
      type: c.type,
      id: c.id,
      genreCapable: (c.extra ?? []).some((e) => e.name === "genre"),
      genres: genreOptions(c),
    }));
}

/** Search pool: every movie/series catalog declaring a `search` extra,
 * whether required (search-only catalogs) or optional (Cinemeta-style
 * top catalogs are browseable AND searchable). Exported for tests. */
export function pickSearchCatalogs(catalogs: CatalogDef[]): DiscoverCatalog[] {
  return catalogs
    .filter(
      (c): c is CatalogDef & { type: "movie" | "series" } =>
        (c.type === "movie" || c.type === "series") &&
        (c.extra ?? []).some((e) => e.name === "search"),
    )
    .map((c) => ({
      type: c.type,
      id: c.id,
      genreCapable: false,
      genres: [],
    }));
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
  const searchCatalogs = pickSearchCatalogs(manifest.catalogs ?? []);
  if (catalogs.length === 0)
    throw new Error("the addon declares no browseable catalogs");
  // Diagnostic (ids/names only — never the manifest URL): which catalogs
  // exist and how each declares genres, for by-hand reports like "the
  // rail is all X" — the answer is usually in this shape.
  console.info(
    `[discover] ${searchCatalogs.length} search catalogs; ${catalogs.length} browseable catalogs: ` +
      catalogs
        .map(
          (c) =>
            `${c.id}(${c.type}): ` +
            (c.genreCapable
              ? c.genres.length
                ? `${c.genres.length} genres`
                : "genre-capable, no options"
              : "no genre extra"),
        )
        .join(" | "),
  );
  return {
    manifestUrl,
    catalogs,
    genres: unionGenres(catalogs),
    searchCatalogs,
  };
}

/**
 * One search, every search-capable catalog of the filtered type, results
 * interleaved + deduped like the browse conglomerate. Single page per
 * catalog — Stremio search rarely paginates, and a first page per source
 * is already plenty for a picker.
 */
export async function searchDiscover(
  cfg: DiscoverConfig,
  filter: "all" | "movie" | "series",
  query: string,
): Promise<VodItem[]> {
  const cats = cfg.searchCatalogs.filter(
    (c) => filter === "all" || c.type === filter,
  );
  const pages = await Promise.all(
    cats.map((c) =>
      fetchCatalog(
        cfg.manifestUrl,
        c.type,
        c.id,
        `search=${encodeURIComponent(query)}`,
      )
        .then((r) =>
          (r.metas ?? []).filter((m) => m?.id && m?.name).map(metaPreviewToVod),
        )
        .catch(() => [] as VodItem[]),
    ),
  );
  const seen = new Set<string>();
  return interleave(...pages).filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
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

/** Can this catalog serve this genre filter? Enumerated options bind
 * (only those genres); a genre extra with NO options means "takes any
 * genre" — treating that as unservable silently benched most of a real
 * manifest and left only the anime catalogs dealing rail art. No genre
 * extra at all = can't be filtered. */
export function servesGenre(cat: DiscoverCatalog, genre: string | null): boolean {
  if (!genre) return true;
  if (!cat.genreCapable) return false;
  if (cat.genres.length === 0) return true;
  return cat.genres.some((g) => g.trim().toLowerCase() === genre.toLowerCase());
}

/** The catalog's OWN casing for a rail genre ("comedy" catalog asked for
 * "Comedy" returns empty on case-sensitive addons) — matching is
 * case-insensitive, the request must not be. */
export function genreForCatalog(
  cat: DiscoverCatalog,
  genre: string | null,
): string | null {
  if (!genre) return null;
  return (
    cat.genres.find((g) => g.trim().toLowerCase() === genre.toLowerCase()) ??
    genre
  );
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
    catalogExtra(genreForCatalog(cat, genre), skip),
  );
  return (res.metas ?? [])
    .filter((m) => m?.id && m?.name)
    .map(metaPreviewToVod);
}

/** Cursor/done key for a catalog. Id ALONE collides: Cinemeta-style
 * manifests reuse one id ("top") for the movie AND series catalog. */
export const catKey = (c: Pick<DiscoverCatalog, "type" | "id">): string =>
  `${c.type}:${c.id}`;

export interface GridSeed {
  /** Interleaved + deduped, ready to render. */
  items: VodItem[];
  /** catKey → how many items the cache already covers; infinite scroll
   * resumes each catalog's skip cursor from there. */
  cursors: Record<string, number>;
}

/**
 * Seed the UNFILTERED grid from the Stream tab's cache: its rows are the
 * same browseable catalogs' first rowCap items, already fetched (and
 * disk-hydrated) — re-requesting them made the tab feel slow. Genre and
 * search grids can't seed (those are SERVER-side filters; the cache only
 * holds each feed's first slice — client-filtering it would show "Comedy
 * = whatever comedies made the top 40" and quietly lie).
 */
export function seedFromStream(
  cfg: DiscoverConfig,
  filter: "all" | "movie" | "series",
): GridSeed | null {
  const data = peekVod();
  if (!data || data.rows.length === 0) return null;
  const lists: VodItem[][] = [];
  const cursors: Record<string, number> = {};
  for (const row of data.rows) {
    const items = row.itemIds
      .map((id) => data.items.get(id))
      .filter((i): i is VodItem => !!i);
    if (items.length === 0) continue;
    // Rows are single-catalog, single-type; the row id carries the
    // catalog id (aio:<id>) and the items carry the type.
    const type = items[0].kind;
    if (filter !== "all" && type !== filter) continue;
    const catId = row.id.replace(/^aio:/, "");
    const cat = cfg.catalogs.find((c) => c.id === catId && c.type === type);
    if (!cat) continue; // row's catalog no longer in the manifest
    cursors[catKey(cat)] = items.length;
    lists.push(items);
  }
  if (lists.length === 0) return null;
  const seen = new Set<string>();
  return {
    items: interleave(...lists).filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    }),
    cursors,
  };
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
const ART_VERSION = 6; // v6: remember WHICH title was dealt (the grid
// pins it first); v5 entries lack the id
const ART_ID_CAP = 600;
const ART_TTL_MS = 50 * 3600_000;
interface ArtMemo {
  byId: Record<string, string>;
  lastByGenre: Record<
    string,
    { url: string; at: number; n: number; id: string }
  >;
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
  m.lastByGenre[genre.toLowerCase()] = { url, at: Date.now(), n, id };
  save(ART_KEY, ART_VERSION, m);
}

/** The title whose backdrop the genre card is wearing right now — the
 * grid pins it to the front so the card's promise is the first thing
 * the click delivers. */
export function genreArtTitle(genre: string): string | null {
  return artMemo().lastByGenre[genre.toLowerCase()]?.id ?? null;
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
    // yields no usable backdrop advances the rotation and falls back to
    // the next — through EVERY serving catalog if needed (a genre only
    // renders the flat card when no source anywhere has art for it).
    // metaBudget bounds the worst case: 3 draws per catalog, ~12 total.
    let n = cached?.n ?? 0;
    let metaBudget = 12;
    for (let hop = 0; hop < serving.length && metaBudget > 0; hop++, n++) {
      const cat = artCatalogFor(serving, genre, n);
      const res = await fetchCatalog(
        cfg.manifestUrl,
        cat.type,
        cat.id,
        catalogExtra(genreForCatalog(cat, genre), 0),
      ).catch(() => null);
      const pool = (res?.metas ?? []).filter((m) => m?.id && m?.name);
      for (
        let attempt = 0;
        attempt < 3 && pool.length > 0 && metaBudget > 0;
        attempt++
      ) {
        const [pick] = pool.splice(Math.floor(Math.random() * pool.length), 1);
        const known = artMemo().byId[pick.id];
        if (!known) metaBudget--;
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
