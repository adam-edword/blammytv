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
const SNOAK_TAKE = 3;
const CATALOG_PICKS = 3;

/**
 * Build the movies/series catalog and the Stream rows from an AIOStreams
 * manifest. Each catalog is best-effort — one failing (or empty) catalog
 * doesn't sink the others, mirroring how the live builder treats playlists.
 *
 * Items are lightweight (poster/title/year): full detail (synopsis, cast,
 * seasons) and playable sources are resolved on-demand when a title is opened.
 * A few featured items are enriched up-front so the hero has artwork.
 */
export async function buildVod(manifestUrl: string): Promise<VodSection> {
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

  // Build the featured carousel, then enrich each item (by its kind) so the
  // hero has artwork + synopsis.
  const featured = await buildFeatured(client, rows, movies, series);
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

/** A catalog is browseable when it has no required extra (search/people/etc.). */
function isBrowseable(cat: CatalogDef): boolean {
  return (cat.extra ?? []).every((e) => !e.isRequired);
}

/**
 * Featured carousel: top {@link SNOAK_TAKE} from each snoak list (fetched
 * directly with `genre=None` — they're not browseable as rows) + 1 random item
 * from each of the first {@link CATALOG_PICKS} homepage rows, all shuffled.
 * Adds the snoak picks to the movies/series maps so the hero can resolve them.
 */
async function buildFeatured(
  client: AddonClient,
  rows: ConfigBlob["stream"]["rows"],
  movies: Map<string, VodItem>,
  series: Map<string, VodItem>,
): Promise<string[]> {
  const ids: string[] = [];

  const [snoakMovies, snoakShows] = await Promise.all([
    client
      .catalog("movie", SNOAK_MOVIES_ID, "genre=None")
      .then((r) => r.metas ?? [])
      .catch((err) => {
        console.warn(`[aiostreams] snoak movies failed: ${msg(err)}`);
        return [];
      }),
    client
      .catalog("series", SNOAK_SHOWS_ID, "genre=None")
      .then((r) => r.metas ?? [])
      .catch((err) => {
        console.warn(`[aiostreams] snoak shows failed: ${msg(err)}`);
        return [];
      }),
  ]);

  for (const m of snoakMovies.slice(0, SNOAK_TAKE)) {
    const item: VodItem = { ...metaPreviewToVod(m), kind: "movie" };
    movies.set(item.id, item);
    if (!ids.includes(item.id)) ids.push(item.id);
  }
  for (const m of snoakShows.slice(0, SNOAK_TAKE)) {
    const item: VodItem = { ...metaPreviewToVod(m), kind: "series" };
    series.set(item.id, item);
    if (!ids.includes(item.id)) ids.push(item.id);
  }

  // One random item from each of the first few homepage rows.
  for (const row of rows.slice(0, CATALOG_PICKS)) {
    const pool = row.itemIds.filter((id) => !ids.includes(id));
    if (pool.length > 0) ids.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  return shuffle(ids);
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
