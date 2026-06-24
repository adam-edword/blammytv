import type { ConfigBlob, StreamSource, VodItem } from "@blammytv/shared";
import { AddonClient } from "./client.js";
import { isSeries, mapStreams, metaPreviewToVod, metaToVod } from "./mapper.js";
import type { CatalogDef } from "./types.js";

/** The slice of the config blob AIOStreams owns: the VOD catalog + Stream tab. */
type VodSection = Pick<ConfigBlob, "movies" | "series" | "stream">;

const ITEMS_PER_ROW = 40;

// Featured carousel sources. The two snoak lists are fetched directly (top 3
// each) — they require a genre param so they're never homepage rows ("carousel
// only"). Plus 1 random item from each of the first few homepage rows. All
// shuffled and re-rolled per build, so the carousel varies on each app load.
const SNOAK_MOVIES_ID = "0c7e3b0.mdblist.175011"; // Today's Most Popular Movies on TV
const SNOAK_SHOWS_ID = "0c7e3b0.mdblist.175012"; // Today's Most Popular Shows on TV
const FEATURED_TOTAL = 9;
const CATALOG_PICKS = 3; // homepage rows in the default carousel mix

/**
 * Build the movies/series catalog and the Stream rows from an AIOStreams
 * manifest. Each catalog is best-effort — one failing (or empty) catalog
 * doesn't sink the others, mirroring how the live builder treats playlists.
 *
 * Items are lightweight (poster/title/year): full detail (synopsis, cast,
 * seasons) and playable sources are resolved on-demand when a title is opened.
 * A few featured items are enriched up-front so the hero has artwork.
 */
export async function buildVod(
  manifestUrl: string,
  carouselSources: string[] = [],
): Promise<VodSection> {
  const client = new AddonClient(manifestUrl);
  const manifest = await client.manifest();
  const browseable = manifest.catalogs.filter(isBrowseable);

  // Fetch every browseable catalog in parallel; Promise.all preserves order so
  // the Stream rows come out in the manifest's order.
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

  // Dedup items across catalogs by id; rows just reference ids in order.
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

  // Build the featured carousel from the chosen catalogs (or a default mix),
  // then enrich each item (by its kind) so the hero has artwork + synopsis.
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

/** Resolve full detail for one title (synopsis, cast, and seasons for series).
 * Used by the on-demand detail endpoint. */
export async function resolveVodItem(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<VodItem | null> {
  const client = new AddonClient(manifestUrl);
  const { meta } = await client.meta(isSeries(type) ? "series" : "movie", id);
  return meta ? metaToVod(meta) : null;
}

/** Resolve ranked playable sources for a title (`tt123`) or episode
 * (`tt123:1:2`). Used by the on-demand sources endpoint. */
export async function resolveSources(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<StreamSource[]> {
  const client = new AddonClient(manifestUrl);
  const { streams = [] } = await client.stream(isSeries(type) ? "series" : "movie", id);
  return mapStreams(streams);
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

/** The carousel sources to use when the user hasn't picked any: the two snoak
 * "most popular on TV" lists + the first few homepage rows. */
function defaultCarousel(rows: ConfigBlob["stream"]["rows"]): string[] {
  const rowCats = rows.slice(0, CATALOG_PICKS).map((r) => r.id.replace(/^aio:/, ""));
  return [SNOAK_MOVIES_ID, SNOAK_SHOWS_ID, ...rowCats];
}

/** Catalogs the Customize picker can choose from (id + type + name). */
export async function listCatalogs(
  manifestUrl: string,
): Promise<Array<{ id: string; type: string; name: string }>> {
  const client = new AddonClient(manifestUrl);
  const manifest = await client.manifest();
  return manifest.catalogs
    .filter(isSelectable)
    .map((c) => ({ id: c.id, type: c.type, name: c.name ?? c.id }));
}

/**
 * Featured carousel: pool the items of each selected catalog, then pick
 * {@link FEATURED_TOTAL} spread evenly across them (round-robin) and shuffled.
 * Catalogs that need a genre are fetched with `genre=None`. Adds the picks to
 * the movies/series maps so the hero can resolve them.
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
    if (!anyAtPass) return out; // every pool exhausted
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
