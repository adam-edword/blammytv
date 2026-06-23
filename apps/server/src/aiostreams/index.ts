import type { ConfigBlob, StreamSource, VodItem } from "@blammytv/shared";
import { AddonClient } from "./client.js";
import { isSeries, mapStreams, metaPreviewToVod, metaToVod } from "./mapper.js";
import type { CatalogDef } from "./types.js";

/** The slice of the config blob AIOStreams owns: the VOD catalog + Stream tab. */
type VodSection = Pick<ConfigBlob, "movies" | "series" | "stream">;

const ITEMS_PER_ROW = 40;
const FEATURED_COUNT = 5;

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

  // Enrich a handful of movies for the auto-advancing hero carousel.
  const featured = pickFeatured(rows, movies);
  await Promise.all(
    featured.map(async (id) => {
      try {
        const { meta } = await client.meta("movie", id);
        if (meta) movies.set(id, metaToVod(meta));
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

/** First few distinct movie ids across the rows, for the hero. */
function pickFeatured(
  rows: ConfigBlob["stream"]["rows"],
  movies: Map<string, VodItem>,
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const id of row.itemIds) {
      if (movies.has(id) && !out.includes(id)) out.push(id);
      if (out.length >= FEATURED_COUNT) return out;
    }
  }
  return out;
}

function label(cat: CatalogDef): string {
  return cat.name ?? cat.id;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
