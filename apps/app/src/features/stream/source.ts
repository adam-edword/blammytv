import {
  fetchCatalog,
  fetchManifest,
  fetchMeta,
  fetchStreams,
  isSeriesType,
  type CatalogDef,
} from "../../data/stremio";
import { loadAioUrl, loadHeroSources } from "../settings/aiostreams";
import { mapStreams, metaPreviewToVod, metaToVod } from "./mapper";
import type { StreamRow, StreamSource, VodData, VodItem } from "./model";

/**
 * The seam between the Stream tab and the user's AIOStreams addon —
 * the sibling of features/live/source.ts. Ported from the old build's
 * `lib/aiostreams/index.ts`: browseable catalogs become homepage rows,
 * a few featured items are meta-enriched up-front so the hero has
 * artwork, sparse titles fall back to Cinemeta, and every catalog is
 * best-effort (one bad row never sinks the tab).
 */

const ITEMS_PER_ROW = 40;
const FEATURED_TOTAL = 9;
const DEFAULT_SOURCE_ROWS = 3; // rows the default hero mix draws from

/** Session cache, keyed by the config that shaped it. In-memory only. */
const CACHE_TTL_MS = 30 * 60_000;
let cache: { key: string; at: number; data: VodData } | null = null;
let inflight: { key: string; promise: Promise<VodData> } | null = null;

const configKey = () =>
  JSON.stringify([loadAioUrl(), loadHeroSources()]);

/** The cached catalog if still current — a remounting Stream screen
 * renders in its first frame. */
export function peekVod(): VodData | null {
  const key = configKey();
  return cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS
    ? cache.data
    : null;
}

export async function loadVod(force = false): Promise<VodData> {
  const key = configKey();
  if (!force && cache && cache.key === key) {
    if (Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
    cache = null;
  }
  if (!force && inflight && inflight.key === key) return inflight.promise;

  const record = { key, promise: doLoad() };
  inflight = record;
  try {
    const data = await record.promise;
    // Only successful, non-empty builds are worth pinning for the TTL.
    if (!data.error && data.items.size > 0) cache = { key, at: Date.now(), data };
    return data;
  } finally {
    if (inflight === record) inflight = null;
  }
}

async function doLoad(): Promise<VodData> {
  const manifestUrl = loadAioUrl();
  if (!manifestUrl) {
    return { items: new Map(), rows: [], featured: [] };
  }
  try {
    return await buildVod(manifestUrl, loadHeroSources());
  } catch (err) {
    console.error(`[stream] catalog failed: ${msg(err)}`);
    return { items: new Map(), rows: [], featured: [], error: msg(err) };
  }
}

/** Build the whole browse surface from the addon manifest. */
export async function buildVod(
  manifestUrl: string,
  heroSources: string[] = [],
): Promise<VodData> {
  const manifest = await fetchManifest(manifestUrl);
  const browseable = manifest.catalogs.filter(isBrowseable);

  const fetched = await Promise.all(
    browseable.map(async (cat) => {
      try {
        const { metas = [] } = await fetchCatalog(manifestUrl, cat.type, cat.id);
        return {
          cat,
          items: metas.slice(0, ITEMS_PER_ROW).map(metaPreviewToVod),
        };
      } catch (err) {
        console.error(`[stream] catalog "${label(cat)}" failed: ${msg(err)}`);
        return { cat, items: [] as VodItem[] };
      }
    }),
  );

  const items = new Map<string, VodItem>();
  const rows: StreamRow[] = [];
  for (const { cat, items: rowItems } of fetched) {
    if (rowItems.length === 0) continue;
    const itemIds: string[] = [];
    for (const item of rowItems) {
      items.set(item.id, item);
      itemIds.push(item.id);
    }
    rows.push({ id: `aio:${cat.id}`, title: label(cat), layout: "poster", itemIds });
  }

  const sourceIds = heroSources.length ? heroSources : defaultHero(rows);
  const featured = await buildFeatured(manifestUrl, manifest.catalogs, sourceIds, items);

  // Enrich the hero picks up-front (backdrop + synopsis); best-effort each.
  await Promise.all(
    featured.map(async (id) => {
      const kind = items.get(id)?.kind ?? "movie";
      try {
        const { meta } = await fetchMeta(manifestUrl, kind, id);
        if (meta) items.set(id, metaToVod(meta));
      } catch (err) {
        console.warn(`[stream] hero enrich failed: ${msg(err)}`);
      }
    }),
  );

  return { items, rows, featured };
}

/** Full detail for one title (synopsis, cast, seasons for series), with the
 * Cinemeta fallback for addons that return bare metadata. */
export async function resolveVodItem(
  type: "movie" | "series",
  id: string,
): Promise<VodItem | null> {
  const manifestUrl = loadAioUrl();
  if (!manifestUrl) return null;
  const { meta } = await fetchMeta(manifestUrl, type, id);
  const primary = meta ? metaToVod(meta) : null;
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

async function cinemetaVod(
  type: string,
  id: string,
): Promise<VodItem | null> {
  if (!/^tt\d+/.test(id)) return null;
  try {
    const { meta } = await fetchMeta(
      CINEMETA_MANIFEST,
      isSeriesType(type) ? "series" : "movie",
      id,
    );
    return meta ? metaToVod(meta) : null;
  } catch (err) {
    console.warn(`[cinemeta] lookup failed: ${msg(err)}`);
    return null;
  }
}

/** Keep everything the addon gave; backfill only what it left empty. */
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

/** Ranked playable sources for a title (`tt123`) or episode (`tt123:1:2`).
 * Resolved fresh on every open — debrid links can be short-lived. */
export async function resolveVodSources(
  kind: "movie" | "series",
  id: string,
): Promise<StreamSource[]> {
  const manifestUrl = loadAioUrl();
  if (!manifestUrl) return [];
  const { streams = [] } = await fetchStreams(manifestUrl, kind, id);
  return mapStreams(streams);
}

/** Browseable = becomes a homepage row: no required extra (search etc.). */
function isBrowseable(cat: CatalogDef): boolean {
  return (cat.extra ?? []).every((e) => !e.isRequired);
}

/** Hero-selectable: browseable, or list-like with only a required `genre`
 * (fetched as `genre=None`). */
function needsGenre(cat: CatalogDef): boolean {
  return (cat.extra ?? []).some((e) => e.isRequired && e.name === "genre");
}

function defaultHero(rows: StreamRow[]): string[] {
  return rows.slice(0, DEFAULT_SOURCE_ROWS).map((r) => r.id.replace(/^aio:/, ""));
}

/** Pool each selected catalog, then pick FEATURED_TOTAL spread evenly
 * (round-robin over shuffled pools, deduped). */
async function buildFeatured(
  manifestUrl: string,
  catalogs: CatalogDef[],
  sourceIds: string[],
  items: Map<string, VodItem>,
): Promise<string[]> {
  const pools = await Promise.all(
    sourceIds.map(async (cid) => {
      const def = catalogs.find((c) => c.id === cid);
      if (!def) return [] as string[];
      try {
        const { metas = [] } = await fetchCatalog(
          manifestUrl,
          def.type,
          def.id,
          needsGenre(def) ? "genre=None" : undefined,
        );
        return metas.slice(0, ITEMS_PER_ROW).map((m) => {
          const item = metaPreviewToVod(m);
          if (!items.has(item.id)) items.set(item.id, item);
          return item.id;
        });
      } catch (err) {
        console.warn(`[stream] hero source "${cid}" failed: ${msg(err)}`);
        return [] as string[];
      }
    }),
  );
  return pickEven(pools, FEATURED_TOTAL);
}

/** Round-robin across shuffled pools, deduped, until `count` or dry. */
export function pickEven(pools: string[][], count: number): string[] {
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

/** NEVER surface a full URL — the manifest URL embeds the user's addon
 * config (a credential), and transport errors echo the whole URL. Same
 * discipline as live/source.ts. */
function msg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/https?:\/\/[^\s"')]+/gi, (m) => {
    try {
      return new URL(m).origin + "/…";
    } catch {
      return "https://…";
    }
  });
}
