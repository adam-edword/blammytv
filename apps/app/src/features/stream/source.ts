import { scrubbedMessage } from "../../lib/errors";
import {
  fetchCatalog,
  fetchManifest,
  fetchMeta,
  fetchStreams,
  isSeriesType,
  type CatalogDef,
} from "../../data/stremio";
import { loadAioUrl, loadHeroSources } from "../settings/aiostreams";
import { loadRowCap } from "../settings/rowCap";
import { load as loadStored, save as saveStored } from "../../lib/storage";
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

// Titles per row: user-set (Settings → Catalog Row Size, default 40).
const FEATURED_TOTAL = 9;
/** Drawn per build, more than are shown: a pick whose full meta fails or
 * has no backdrop stays out of the hero, and a spare takes its place. */
const FEATURED_DRAW = 12;
/** The longest a build waits on its hero's full meta. The rows wait with
 * it, so the tab paints once with a finished hero. */
const FEATURED_WAIT_MS = 4000;
const DEFAULT_SOURCE_ROWS = 3; // rows the default hero mix draws from

/** Session cache, keyed by the config that shaped it, mirrored to disk so
 * a fresh launch paints the last catalog instantly (stale-while-revalidate:
 * peekVod serves any age for display; loadVod refetches past the TTL). */
const CACHE_TTL_MS = 30 * 60_000;
let cache: { key: string; at: number; data: VodData } | null = null;
let inflight: { key: string; promise: Promise<VodData> } | null = null;

/** The identity of the catalog a screen is showing. Exported because the
 * home tab's remembered scroll offset is only meaningful against the same
 * one: a changed addon, hero set or row cap re-lays the whole page. */
export const configKey = () =>
  JSON.stringify([loadAioUrl(), loadHeroSources(), loadRowCap()]);

const DISK_KEY = "vodCache";
/** 2 since v0.9.123: a version-1 mirror could hold a hero of bare catalog
 * previews (saved before their full meta landed), and that is exactly
 * what must never be shown again. */
const DISK_VERSION = 2;
interface DiskVod {
  key: string;
  at: number;
  items: VodItem[];
  rows: StreamRow[];
  featured: string[];
}
function diskLoad(key: string): { at: number; data: VodData } | null {
  const d = loadStored<DiskVod | null>(DISK_KEY, DISK_VERSION, null);
  if (
    !d ||
    d.key !== key ||
    !Array.isArray(d.items) ||
    !Array.isArray(d.rows) ||
    !Array.isArray(d.featured)
  )
    return null;
  return {
    at: d.at,
    data: {
      items: new Map(d.items.map((i) => [i.id, i])),
      rows: d.rows,
      featured: d.featured,
    },
  };
}
function diskSave(key: string, at: number, data: VodData): void {
  if (data.error || data.items.size === 0) return;
  saveStored<DiskVod>(DISK_KEY, DISK_VERSION, {
    key,
    at,
    items: [...data.items.values()],
    rows: data.rows,
    featured: data.featured,
  });
}

/** The last built catalog for the current config, ANY age — display it
 * immediately; loadVod refreshes (and repaints) if it's past the TTL. */
export function peekVod(): VodData | null {
  const key = configKey();
  if (cache && cache.key === key) return cache.data;
  const disk = diskLoad(key);
  if (disk) {
    // Hydrate the memory slot with the original timestamp so loadVod's
    // TTL check decides honestly whether a refresh is due.
    cache = { key, at: disk.at, data: disk.data };
    return disk.data;
  }
  return null;
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
    // Only successful, non-empty builds are worth pinning for the TTL —
    // and only if the config hasn't moved on while this one was in flight
    // (a late finisher must not clobber a newer build's cache/mirror).
    if (!data.error && data.items.size > 0 && configKey() === key) {
      const at = Date.now();
      cache = { key, at, data };
      diskSave(key, at, data);
    }
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
    return await buildVod(manifestUrl, loadHeroSources(), loadRowCap());
  } catch (err) {
    console.error(`[stream] catalog failed: ${msg(err)}`);
    return { items: new Map(), rows: [], featured: [], error: msg(err) };
  }
}

/** Build the whole browse surface from the addon manifest. */
async function buildVod(
  manifestUrl: string,
  heroSources: string[] = [],
  rowCap = 40,
): Promise<VodData> {
  const manifest = await fetchManifest(manifestUrl);
  const browseable = manifest.catalogs.filter(isBrowseable);

  const fetched = await Promise.all(
    browseable.map(async (cat) => {
      try {
        const { metas = [] } = await fetchCatalog(manifestUrl, cat.type, cat.id);
        return {
          cat,
          items: metas.slice(0, rowCap).map(metaPreviewToVod),
        };
      } catch (err) {
        console.error(`[stream] catalog "${label(cat)}" failed: ${msg(err)}`);
        return { cat, items: [] as VodItem[] };
      }
    }),
  );

  const items = new Map<string, VodItem>();
  const rows: StreamRow[] = [];
  // Row fetches double as hero pools (both key forms) — buildFeatured must
  // never re-fetch a catalog this wave already has.
  const rowPools = new Map<string, string[]>();
  for (const { cat, items: rowItems } of fetched) {
    if (rowItems.length === 0) continue;
    const itemIds: string[] = [];
    for (const item of rowItems) {
      items.set(item.id, item);
      itemIds.push(item.id);
    }
    rows.push({ id: `aio:${cat.id}`, title: label(cat), layout: "poster", itemIds });
    rowPools.set(`${cat.type}/${cat.id}`, itemIds);
    rowPools.set(cat.id, itemIds);
  }

  const sourceIds = heroSources.length ? heroSources : defaultHero(rows);
  const picks = await buildFeatured(
    manifestUrl,
    manifest.catalogs,
    sourceIds,
    items,
    rowPools,
    rowCap,
  );
  const featured = await enrichFeatured(manifestUrl, picks, items);
  return { items, rows, featured };
}

/**
 * The hero's picks, with their full meta, in pick order: a pick joins the
 * hero only once its full meta is back with a backdrop in it.
 *
 * A catalog preview has neither the backdrop nor the logo (mapper.ts), so
 * a hero card built from one is the portrait poster stretched across the
 * screen under a plain-text title. Until v0.9.123 the rows and the hero
 * painted from previews and the meta arrived after, card by card; and the
 * disk mirror was written before it arrived, so a relaunch inside the TTL
 * could show the previews for the whole session.
 *
 * Settles when FEATURED_TOTAL are ready, when every pick has answered, or
 * at FEATURED_WAIT_MS, whichever is first; a late answer is dropped.
 */
async function enrichFeatured(
  manifestUrl: string,
  picks: string[],
  items: Map<string, VodItem>,
): Promise<string[]> {
  const ready = new Map<string, VodItem>();
  await new Promise<void>((resolve) => {
    if (picks.length === 0) return resolve();
    const timer = setTimeout(resolve, FEATURED_WAIT_MS);
    let answered = 0;
    for (const id of picks) {
      fetchMeta(manifestUrl, items.get(id)?.kind ?? "movie", id)
        .then(
          ({ meta }) => {
            const full = meta ? metaToVod(meta) : null;
            // Under the catalog's id, whatever the meta calls itself: the
            // rows, the streams and the disk mirror are keyed by it, and a
            // meta answering under another id fell out of the mirror.
            if (full?.backdrop) ready.set(id, { ...full, id });
          },
          (err) => console.warn(`[stream] hero enrich failed: ${msg(err)}`),
        )
        .finally(() => {
          answered++;
          if (ready.size >= FEATURED_TOTAL || answered === picks.length) {
            clearTimeout(timer);
            resolve();
          }
        });
    }
  });
  const featured = picks.filter((id) => ready.has(id)).slice(0, FEATURED_TOTAL);
  for (const id of featured) items.set(id, ready.get(id)!);
  return featured;
}

/**
 * What a refresh shows, given what is on screen: the hero keeps its titles.
 *
 * A build past the TTL draws a new random set, and it lands a second or so
 * after the tab has painted the last one from disk. Swapping it in then
 * changes every card under you and loses your place in the carousel, for
 * nothing: the picks are random either way. The rows take the new build,
 * and the new picks are what the tab opens on next time (the mirror has
 * them). `shown` is null when nothing was on screen.
 */
export function keepHero(shown: VodData | null, next: VodData): VodData {
  if (!shown || shown === next || shown.featured.length === 0) return next;
  const items = new Map(next.items);
  const featured = shown.featured.filter((id) => shown.items.has(id));
  for (const id of featured) items.set(id, shown.items.get(id)!);
  return { ...next, items, featured };
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

/** Pool each selected catalog, then draw FEATURED_DRAW spread evenly
 * (round-robin over shuffled pools, deduped). */
async function buildFeatured(
  manifestUrl: string,
  catalogs: CatalogDef[],
  sourceIds: string[],
  items: Map<string, VodItem>,
  rowPools: Map<string, string[]>,
  rowCap: number,
): Promise<string[]> {
  const pools = await Promise.all(
    sourceIds.map(async (cid) => {
      // Browseable sources were fetched for the rows this same build —
      // reuse that pool instead of a duplicate round trip.
      const pooled = rowPools.get(cid);
      if (pooled) return [...pooled];
      // Saved hero sources are `${type}/${id}` keys (Settings' picker);
      // the default mix passes bare catalog ids. Accept both.
      const def = catalogs.find(
        (c) => `${c.type}/${c.id}` === cid || c.id === cid,
      );
      if (!def) return [] as string[];
      try {
        const { metas = [] } = await fetchCatalog(
          manifestUrl,
          def.type,
          def.id,
          needsGenre(def) ? "genre=None" : undefined,
        );
        return metas.slice(0, rowCap).map((m) => {
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
  return pickEven(pools, FEATURED_DRAW);
}

/** Round-robin across shuffled pools, deduped, until `count` or dry. */
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
const msg = scrubbedMessage;
