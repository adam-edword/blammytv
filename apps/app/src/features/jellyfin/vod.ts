/**
 * A Jellyfin server's libraries as Stream's rows, and its titles and files on
 * demand (plan 027, D1): the page's side of what browse.ts, ids.ts and
 * sources.ts describe in the Stremio shapes. The sibling of stream/source.ts,
 * which does the same for the AIOStreams addon, and built to the same rules:
 * every library is best-effort, a bad row never sinks the tab, and the last
 * build is kept on disk so a launch paints at once.
 *
 * Nothing here is merged with the addon's catalog. A title found in both
 * appears in both, and which one is meant travels with it: every item built
 * here carries `from: "jf"`, and the resolvers below are only asked for such
 * an item (stream/source.ts routes on it).
 */

import { scrubbedMessage } from "../../lib/errors";
import { load as loadStored, save as saveStored } from "../../lib/storage";
import type { MetaPreview } from "../../data/stremio";
import { loadRowCap } from "../settings/rowCap";
import { mapStreams, metaPreviewToVod, metaToVod } from "../stream/mapper";
import type { StreamRow, StreamSource, VodData, VodItem } from "../stream/model";
import { jfCall } from "./account";
import { catalogOf, catalogQuery, episodesQuery, itemQuery, metaDetailOf, metaPreviewOf, searchQuery } from "./browse";
import { jfPrepareStream, jfSources } from "./client";
import { jfIdFor, rememberJfIds } from "./idmap";
import { jellyfinIdOfKey, episodeKey } from "./ids";
import type { JfItem } from "./items";
import { streamsOf } from "./sources";
import { forgetCount, loadJfConn, type JfConn } from "./store";

/** The hero's size, as stream/source.ts keeps it. */
const FEATURED_TOTAL = 9;
const CACHE_TTL_MS = 30 * 60_000;
const DISK_KEY = "jfVodCache";
const DISK_VERSION = 1;

const msg = scrubbedMessage;

/** What identifies the build a screen is showing: the server and user, and the
 * row size. Empty with no server. */
export const jfVodKey = (): string => {
  const c = loadJfConn();
  return c ? JSON.stringify([c.key, loadRowCap()]) : "";
};

const fromJf = (v: VodItem): VodItem => ({ ...v, from: "jf" });

// ---------------------------------------------------------------------------
// The browse surface
// ---------------------------------------------------------------------------

interface DiskVod {
  key: string;
  at: number;
  items: VodItem[];
  rows: StreamRow[];
  featured: string[];
}

/** `gen` is the sign-out count the build was made under: a sign-out (and Clear
 * All Login Info, which does one) empties the memory copy as it does the
 * mirror, even for the same server and user signing straight back in. */
let cache: { key: string; at: number; gen: number; data: VodData } | null = null;
let inflight: { key: string; promise: Promise<VodData> } | null = null;

function diskLoad(key: string): { at: number; data: VodData } | null {
  const d = loadStored<DiskVod | null>(DISK_KEY, DISK_VERSION, null);
  if (!d || d.key !== key || !Array.isArray(d.items) || !Array.isArray(d.rows) || !Array.isArray(d.featured))
    return null;
  return {
    at: d.at,
    data: { items: new Map(d.items.map((i) => [i.id, i])), rows: d.rows, featured: d.featured },
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

/** The last build for this server, any age, or null. */
export function peekJfVod(): VodData | null {
  const key = jfVodKey();
  if (!key) return null;
  if (cache && cache.key === key && cache.gen === forgetCount()) return cache.data;
  const disk = diskLoad(key);
  if (!disk) return null;
  cache = { key, at: disk.at, gen: forgetCount(), data: disk.data };
  return disk.data;
}

/** The server's libraries as rows. Resolves to an empty build with no server,
 * and to one with `error` when the server could not be read at all. */
export async function loadJfVod(force = false): Promise<VodData> {
  const key = jfVodKey();
  if (!key) return { items: new Map(), rows: [], featured: [] };
  if (!force && cache && cache.key === key && cache.gen === forgetCount()) {
    if (Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
    cache = null;
  }
  if (!force && inflight && inflight.key === key) return inflight.promise;
  const gen = forgetCount();
  const record = { key, promise: doLoad() };
  inflight = record;
  try {
    const data = await record.promise;
    // Only a build that worked is pinned, and only if the sign-in has not
    // moved on while it ran (a sign-out must not be answered with a mirror).
    if (!data.error && data.items.size > 0 && jfVodKey() === key && forgetCount() === gen) {
      const at = Date.now();
      cache = { key, at, gen, data };
      diskSave(key, at, data);
    }
    return data;
  } finally {
    if (inflight === record) inflight = null;
  }
}

async function doLoad(): Promise<VodData> {
  const conn = loadJfConn();
  if (!conn) return { items: new Map(), rows: [], featured: [] };
  try {
    return await buildJfVod(conn, loadRowCap());
  } catch (err) {
    console.error(`[jellyfin] catalog failed: ${msg(err)}`);
    return { items: new Map(), rows: [], featured: [], error: msg(err) };
  }
}

/** A page of `/Items` as Stream's cards, and the Jellyfin id each one's key
 * stands for (idmap.ts keeps those, so a card opened later finds its item). */
function previewsOf(conn: JfConn, items: readonly JfItem[]): { entries: VodItem[]; ids: [string, string][] } {
  const entries: VodItem[] = [];
  const ids: [string, string][] = [];
  for (const it of items) {
    const p: MetaPreview | null = metaPreviewOf(it, conn.base);
    if (!p || !it.Id) continue;
    entries.push(fromJf(metaPreviewToVod(p)));
    ids.push([p.id, it.Id]);
  }
  return { entries, ids };
}

async function buildJfVod(conn: JfConn, rowCap: number): Promise<VodData> {
  const views = await jfCall<{ Items?: JfItem[] }>("GET", "/UserViews", { query: { userId: conn.userId } });
  if (views.status !== 200 || !views.data)
    throw new Error(views.status === 401 ? "Jellyfin has signed you out" : `Jellyfin answered ${views.status}`);
  const catalogs = (views.data.Items ?? []).flatMap((v) => {
    const c = catalogOf(v);
    return c ? [c] : [];
  });

  const fetched = await Promise.all(
    catalogs.map(async (cat) => {
      try {
        const r = await jfCall<{ Items?: JfItem[] }>("GET", "/Items", {
          query: catalogQuery(conn.userId, cat, { limit: rowCap }),
        });
        if (r.status !== 200 || !r.data) throw new Error(`Jellyfin answered ${r.status}`);
        const { entries, ids } = previewsOf(conn, r.data.Items ?? []);
        return { cat, items: entries.slice(0, rowCap), ids };
      } catch (err) {
        console.error(`[jellyfin] library "${cat.name ?? cat.id}" failed: ${msg(err)}`);
        return { cat, items: [] as VodItem[], ids: [] as [string, string][] };
      }
    }),
  );

  const items = new Map<string, VodItem>();
  const rows: StreamRow[] = [];
  const named: [string, string][] = [];
  for (const { cat, items: rowItems, ids } of fetched) {
    named.push(...ids);
    if (rowItems.length === 0) continue;
    const itemIds: string[] = [];
    for (const item of rowItems) {
      if (!items.has(item.id)) items.set(item.id, item);
      itemIds.push(item.id);
    }
    rows.push({ id: `jf:${cat.id}`, title: cat.name ?? cat.id, layout: "poster", itemIds });
  }
  rememberJfIds(conn.base, named);

  // The hero: titles that came with a backdrop, a spread over the libraries.
  // A catalog page carries its art, so no second read is needed here.
  const pools = rows.map((r) => shuffle(r.itemIds.filter((id) => !!items.get(id)?.backdrop)));
  return { items, rows, featured: spread(pools, FEATURED_TOTAL) };
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Round-robin over the pools, deduped, up to `count`. */
function spread(pools: string[][], count: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let pass = 0; out.length < count; pass++) {
    let any = false;
    for (const pool of pools) {
      if (pass >= pool.length) continue;
      any = true;
      const id = pool[pass];
      if (!seen.has(id) && out.length < count) {
        seen.add(id);
        out.push(id);
      }
    }
    if (!any) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

/** A library as a Discover catalog: no more than its type, id and name. */
export interface JfCat {
  type: "movie" | "series";
  id: string;
  name: string;
}

export interface JfDiscover {
  conn: JfConn;
  catalogs: JfCat[];
  /** The genres the titles Stream already read carry, in the order first
   * seen. The server filters any genre by name, so this is only what the rail
   * offers, and a genre that shows up only deeper in a library is not on it. */
  genres: string[];
}

/** What Discover browses on the signed-in server, read off the same build
 * Stream's rows come from (one `/UserViews`, one page per library), so
 * opening Discover after Stream costs nothing. Null with no server; throws
 * when the server could not be read at all. A library with nothing in it
 * has no row, and so no catalog. */
export async function loadJfDiscover(): Promise<JfDiscover | null> {
  const conn = loadJfConn();
  if (!conn) return null;
  const data = await loadJfVod();
  if (data.error) throw new Error(data.error);
  const catalogs: JfCat[] = [];
  const genres: string[] = [];
  const seen = new Set<string>();
  for (const row of data.rows) {
    const first = data.items.get(row.itemIds[0]);
    if (!first || !row.id.startsWith("jf:")) continue;
    catalogs.push({ type: first.kind, id: row.id.slice(3), name: row.title });
    for (const id of row.itemIds)
      for (const g of data.items.get(id)?.genres ?? []) {
        const k = g.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        genres.push(g.trim());
      }
  }
  return { conn, catalogs, genres };
}

/** One page of a library, past `skip` titles, optionally of one genre. Rejects
 * when the server does not answer 200, so the caller can tell a failure from
 * an empty page. */
export async function fetchJfPage(cat: Pick<JfCat, "type" | "id">, genre: string | null, skip: number): Promise<VodItem[]> {
  const conn = loadJfConn();
  if (!conn) return [];
  const r = await jfCall<{ Items?: JfItem[] }>("GET", "/Items", {
    query: catalogQuery(conn.userId, { type: cat.type, id: cat.id }, { skip, ...(genre ? { genre } : {}) }),
  });
  if (r.status !== 200 || !r.data) throw new Error(`Jellyfin answered ${r.status}`);
  const { entries, ids } = previewsOf(conn, r.data.Items ?? []);
  rememberJfIds(conn.base, ids);
  return entries;
}

/** A search over every library for one type. Rejects like `fetchJfPage`. */
export async function searchJf(type: "movie" | "series", term: string): Promise<VodItem[]> {
  const conn = loadJfConn();
  if (!conn) return [];
  const r = await jfCall<{ Items?: JfItem[] }>("GET", "/Items", {
    query: searchQuery(conn.userId, type, { search: term }),
  });
  if (r.status !== 200 || !r.data) throw new Error(`Jellyfin answered ${r.status}`);
  const { entries, ids } = previewsOf(conn, r.data.Items ?? []);
  rememberJfIds(conn.base, ids);
  return entries;
}

// ---------------------------------------------------------------------------
// One title
// ---------------------------------------------------------------------------

/** An episode's Jellyfin id, by the key the app calls it. Read off the shows'
 * episode lists as they are fetched, this session only: a show's list is cheap
 * to read again, and an episode never needs to outlive it. */
const episodeIds = new Map<string, string>();

function noteEpisodes(conn: JfConn, seriesKey: string, eps: readonly JfItem[]): void {
  for (const ep of eps) {
    const k = ep.Id ? episodeKey(ep, seriesKey) : null;
    if (k && ep.Id) episodeIds.set(`${conn.key}|${k}`, ep.Id);
  }
}

async function readEpisodes(conn: JfConn, seriesJid: string): Promise<JfItem[]> {
  const r = await jfCall<{ Items?: JfItem[] }>("GET", `/Shows/${seriesJid}/Episodes`, {
    query: episodesQuery(conn.userId),
  });
  if (r.status === 404) return [];
  if (r.status !== 200 || !r.data) throw new Error(`Jellyfin answered ${r.status}`);
  return r.data.Items ?? [];
}

/** A film or show's detail, from the server. Null when the server does not
 * have it (or its key names nothing this device has seen). Under the key it
 * was asked for, whatever the server's own say. */
export async function resolveJfItem(key: string): Promise<VodItem | null> {
  const conn = loadJfConn();
  if (!conn) return null;
  const jid = jfIdFor(conn.base, key);
  if (!jid) return null;
  const r = await jfCall<JfItem>("GET", `/Items/${jid}`, { query: itemQuery(conn.userId) });
  if (r.status === 404) return null;
  if (r.status !== 200 || !r.data) throw new Error(`Jellyfin answered ${r.status}`);
  const eps = r.data.Type === "Series" ? await readEpisodes(conn, jid) : [];
  const meta = metaDetailOf(r.data, eps, conn.base);
  if (!meta) return null;
  const titleId = meta.id;
  if (r.data.Type === "Series") noteEpisodes(conn, titleId, eps);
  return fromJf({ ...metaToVod(meta), id: key });
}

/** The Jellyfin id of what a key names: a film's or a show's, an episode's
 * (`tt…:S:E`, found by reading its show), or an opaque `jf:` one's own. */
async function jellyfinIdOf(conn: JfConn, kind: "movie" | "series", key: string): Promise<string | null> {
  const own = jellyfinIdOfKey(key);
  if (own) return own;
  if (kind === "movie") return jfIdFor(conn.base, key);
  const hit = episodeIds.get(`${conn.key}|${key}`);
  if (hit) return hit;
  const seriesKey = /^(tt\d+):\d+:\d+$/.exec(key)?.[1];
  if (!seriesKey) return null;
  const sid = jfIdFor(conn.base, seriesKey);
  if (!sid) return null;
  noteEpisodes(conn, seriesKey, await readEpisodes(conn, sid));
  return episodeIds.get(`${conn.key}|${key}`) ?? null;
}

/** The Jellyfin item a film's or an episode's key names, or null when this
 * device cannot tell. The reports, the skip markers and the sync's "clear this
 * card" all ask the server about an item by this. */
export async function jfItemIdFor(kind: "movie" | "series", key: string): Promise<string | null> {
  const conn = loadJfConn();
  return conn ? jellyfinIdOf(conn, kind, key) : null;
}

/** The play session the server minted for an item's last file lookup, so what
 * is reported while it plays is filed under it. This session only. */
const playSessions = new Map<string, string>();
export const playSessionOf = (jid: string): string | undefined => playSessions.get(jid);

export interface JfList {
  sources: StreamSource[];
  notices: string[];
}

/** The files the server holds for a film or an episode, as Stream's sources.
 * The server already has them, so nothing is searched: one read, no cache.
 * Before the list is handed back the first file is checked (jf.rs
 * `prepare_stream`), which is what decides whether mpv is given the token as a
 * header for this server's streams. */
export async function resolveJfList(kind: "movie" | "series", key: string): Promise<JfList> {
  const conn = loadJfConn();
  if (!conn) return { sources: [], notices: [] };
  const jid = await jellyfinIdOf(conn, kind, key);
  if (!jid) return { sources: [], notices: ["This title is not in your Jellyfin library."] };
  const r = await jfSources(jid);
  if (r.status === 404) return { sources: [], notices: ["Jellyfin does not have this title any more."] };
  if (r.status !== 200) return { sources: [], notices: [`Jellyfin answered ${r.status}.`] };
  if (r.playSessionId) playSessions.set(jid, r.playSessionId);
  const sources = mapStreams(streamsOf(conn.base, jid, r.sources));
  if (sources.length === 0) return { sources, notices: ["Jellyfin has no playable file for this."] };
  await jfPrepareStream(sources[0].streamUrl).catch((e) =>
    console.warn(`[jellyfin] stream check failed: ${msg(e)}`),
  );
  return { sources, notices: [] };
}
