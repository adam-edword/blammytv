import type { ConfigBlob, StreamSource, VodItem } from "@blammytv/shared";
import { AddonClient } from "./client";
import { isSeries, mapStreams, metaPreviewToVod, metaToVod } from "./mapper";
import type { AddonManifest, CatalogDef } from "./types";

// The manifest doesn't change within a session, so fetch it once per URL and
// share it across the initial load and every later search — otherwise each
// search pays an extra round trip just to re-read the catalog list. Cache the
// promise (dedupes concurrent calls); drop it on failure so a retry can refetch.
const manifestCache = new Map<string, Promise<AddonManifest>>();
function cachedManifest(client: AddonClient, url: string): Promise<AddonManifest> {
  let p = manifestCache.get(url);
  if (!p) {
    p = client.manifest().catch((err) => {
      manifestCache.delete(url);
      throw err;
    });
    manifestCache.set(url, p);
  }
  return p;
}

/** The slice of the config blob AIOStreams owns: the VOD catalog + Stream tab. */
type VodSection = Pick<ConfigBlob, "movies" | "series" | "stream">;

const ITEMS_PER_ROW = 16;
const FEATURED_TOTAL = 9;
const DEFAULT_SOURCE_ROWS = 3; // rows the default carousel draws from

/**
 * Build the movies/series catalog and the Stream rows from an AIOStreams
 * manifest. Items are lightweight; detail + sources resolve on-demand. A few
 * featured items are enriched up-front so the hero has artwork.
 */
export async function buildVod(
  manifestUrl: string,
  carouselSources: string[] = [],
): Promise<VodSection> {
  const client = new AddonClient(manifestUrl);
  const manifest = await cachedManifest(client, manifestUrl);
  const browseable = manifest.catalogs.filter(isBrowseable);

  const fetched = await Promise.all(
    browseable.map(async (cat) => {
      try {
        const { metas = [] } = await client.catalog(cat.type, cat.id);
        return { cat, items: metas.slice(0, ITEMS_PER_ROW).map(metaPreviewToVod) };
      } catch (err) {
        console.error(`[aiostreams] catalog "${label(cat)}" failed: ${msg(err)}`);
        return { cat, items: [] as VodItem[] };
      }
    }),
  );

  const movies = new Map<string, VodItem>();
  const series = new Map<string, VodItem>();
  const rows: ConfigBlob["stream"]["rows"] = [];

  for (const { cat, items } of fetched) {
    if (items.length === 0) continue;
    const itemIds: string[] = [];
    for (const item of items) {
      (item.kind === "series" ? series : movies).set(item.id, item);
      itemIds.push(item.id);
    }
    rows.push({ id: `aio:${cat.id}`, title: label(cat), layout: "poster", itemIds });
  }

  const sourceIds = carouselSources.length
    ? carouselSources
    : defaultCarousel(rows);
  const featured = await buildFeatured(
    client,
    manifest.catalogs,
    sourceIds,
    movies,
    series,
  );
  await Promise.all(
    featured.map(async (id) => {
      const inSeries = series.has(id);
      try {
        const { meta } = await client.meta(inSeries ? "series" : "movie", id);
        if (meta) (inSeries ? series : movies).set(id, metaToVod(meta));
      } catch (err) {
        console.warn(`[aiostreams] hero enrich ${id} failed: ${msg(err)}`);
      }
    }),
  );

  return {
    movies: [...movies.values()],
    series: [...series.values()],
    stream: { featured, rows },
  };
}

/**
 * Search the addon's search-capable catalogs (Stremio `search` extra) and merge
 * the results, deduped by id. Items are lightweight previews; detail + sources
 * resolve on-demand via the existing open flow.
 */
export async function searchVod(
  manifestUrl: string,
  query: string,
): Promise<VodItem[]> {
  const q = query.trim();
  if (!q) return [];
  const client = new AddonClient(manifestUrl);
  const manifest = await cachedManifest(client, manifestUrl);
  const searchCats = manifest.catalogs.filter((cat) =>
    (cat.extra ?? []).some((e) => e.name === "search"),
  );
  const extra = `search=${encodeURIComponent(q)}`;
  const pools = await Promise.all(
    searchCats.map(async (cat) => {
      try {
        const { metas = [] } = await client.catalog(cat.type, cat.id, extra);
        const kind = isSeries(cat.type) ? "series" : "movie";
        return metas.map((m): VodItem => ({ ...metaPreviewToVod(m), kind }));
      } catch (err) {
        console.warn(`[aiostreams] search "${label(cat)}" failed: ${msg(err)}`);
        return [] as VodItem[];
      }
    }),
  );
  const seen = new Set<string>();
  const out: VodItem[] = [];
  for (const pool of pools) {
    for (const item of pool) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Full detail for one title (synopsis, cast, and seasons for series). */
export async function resolveVodItem(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<VodItem | null> {
  const client = new AddonClient(manifestUrl);
  const { meta } = await client.meta(isSeries(type) ? "series" : "movie", id);
  const primary = meta ? metaToVod(meta) : null;
  // If the user's addon has no metadata source configured, the title comes back
  // bare — fall back to Stremio's free Cinemeta and fill in the gaps.
  if (isSparse(primary)) {
    const fallback = await cinemetaVod(type, id);
    if (fallback) return primary ? mergeVod(primary, fallback) : fallback;
  }
  return primary;
}

/** Stremio's public, keyless metadata addon (IMDb ids only). */
const CINEMETA_MANIFEST = "https://v3-cinemeta.strem.io/manifest.json";

/** A title with no poster and no synopsis is effectively un-presentable. */
function isSparse(v: VodItem | null): boolean {
  return !v || (!v.poster && !v.synopsis);
}

/** Look a title up in Cinemeta. Only IMDb-keyed ids (`tt…`) are supported. */
async function cinemetaVod(type: string, id: string): Promise<VodItem | null> {
  if (!/^tt\d+/.test(id)) return null;
  try {
    const { meta } = await new AddonClient(CINEMETA_MANIFEST).meta(
      isSeries(type) ? "series" : "movie",
      id,
    );
    return meta ? metaToVod(meta) : null;
  } catch (err) {
    console.warn(`[cinemeta] ${id} failed: ${msg(err)}`);
    return null;
  }
}

/** Keep everything the addon gave us; backfill only the fields it left empty. */
function mergeVod(primary: VodItem, fb: VodItem): VodItem {
  return {
    ...primary,
    title: primary.title || fb.title,
    year: primary.year ?? fb.year,
    poster: primary.poster ?? fb.poster,
    backdrop: primary.backdrop ?? fb.backdrop,
    logo: primary.logo ?? fb.logo,
    rating: primary.rating ?? fb.rating,
    runtimeMin: primary.runtimeMin ?? fb.runtimeMin,
    synopsis: primary.synopsis || fb.synopsis,
    genres: primary.genres.length ? primary.genres : fb.genres,
    cast: primary.cast.length ? primary.cast : fb.cast,
    seasons: primary.seasons.length ? primary.seasons : fb.seasons,
  };
}

/** Ranked playable sources for a title (`tt123`) or episode (`tt123:1:2`). */
export async function resolveSources(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<StreamSource[]> {
  const client = new AddonClient(manifestUrl);
  const { streams = [] } = await client.stream(isSeries(type) ? "series" : "movie", id);
  return mapStreams(streams);
}

/** Catalogs the Customize picker can choose from (id + type + name). */
export async function listCatalogs(
  manifestUrl: string,
): Promise<Array<{ id: string; type: string; name: string }>> {
  const client = new AddonClient(manifestUrl);
  const manifest = await cachedManifest(client, manifestUrl);
  return manifest.catalogs
    .filter(isSelectable)
    .map((c) => ({ id: c.id, type: c.type, name: c.name ?? c.id }));
}

/** A catalog is browseable (becomes a homepage row) when it has no required
 * extra (search/people/etc.). */
function isBrowseable(cat: CatalogDef): boolean {
  return (cat.extra ?? []).every((e) => !e.isRequired);
}

/** A catalog the carousel can pull from: browseable, or list-like with only a
 * required `genre` (which has a "None" option). Excludes search/people/etc. */
function isSelectable(cat: CatalogDef): boolean {
  return (cat.extra ?? []).every((e) => !e.isRequired || e.name === "genre");
}

/** Default carousel sources when the user hasn't picked any: the first few
 * homepage rows. (Add curated lists via the Customize → Carousel sources picker.) */
function defaultCarousel(rows: ConfigBlob["stream"]["rows"]): string[] {
  return rows.slice(0, DEFAULT_SOURCE_ROWS).map((r) => r.id.replace(/^aio:/, ""));
}

/**
 * Featured carousel: pool each selected catalog's items, then pick
 * {@link FEATURED_TOTAL} spread evenly across them (round-robin) and shuffled.
 * Catalogs that need a genre are fetched with `genre=None`.
 */
async function buildFeatured(
  client: AddonClient,
  catalogs: CatalogDef[],
  sourceIds: string[],
  movies: Map<string, VodItem>,
  series: Map<string, VodItem>,
): Promise<string[]> {
  const pools = await Promise.all(
    sourceIds.map(async (cid) => {
      const def = catalogs.find((c) => c.id === cid);
      if (!def) return [] as string[];
      const needsGenre = (def.extra ?? []).some(
        (e) => e.isRequired && e.name === "genre",
      );
      try {
        const { metas = [] } = await client.catalog(
          def.type,
          def.id,
          needsGenre ? "genre=None" : undefined,
        );
        const kind = isSeries(def.type) ? "series" : "movie";
        return metas.slice(0, ITEMS_PER_ROW).map((m) => {
          const item: VodItem = { ...metaPreviewToVod(m), kind };
          (kind === "series" ? series : movies).set(item.id, item);
          return item.id;
        });
      } catch (err) {
        console.warn(`[aiostreams] carousel "${cid}" failed: ${msg(err)}`);
        return [] as string[];
      }
    }),
  );

  return pickEven(pools, FEATURED_TOTAL);
}

/** Pick `count` ids spread evenly across the pools: round-robin by index over
 * a shuffled pool order, items within each pool shuffled, deduped. */
function pickEven(pools: string[][], count: number): string[] {
  const order = shuffle(pools.map((p) => shuffle([...p])));
  const out: string[] = [];
  const seen = new Set<string>();
  let pass = 0;
  for (;;) {
    let anyAtPass = false;
    for (const pool of order) {
      if (out.length >= count) return out;
      if (pass < pool.length) {
        anyAtPass = true;
        const id = pool[pass];
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
    if (!anyAtPass) return out;
    pass++;
  }
}

/** Fisher–Yates shuffle in place; returns the same array. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function label(cat: CatalogDef): string {
  return cat.name ?? cat.id;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
