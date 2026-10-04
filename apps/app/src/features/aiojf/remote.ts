/**
 * The Stremio addon's answers, read from AIOStreams' Jellyfin side (plan 024).
 *
 * The network half of the adapter whose pure half is browse.ts: catalogs from
 * `/UserViews`, a page from `/Items?ParentId=`, a title from `/Items/{id}` and
 * `/Shows/{id}/Episodes`, sources from the native `aiojf_sources`. Every call
 * rides account.ts, so a 401 is seen in one place. Answers come back in the
 * shapes data/stremio.ts declares, with Stremio ids, so nothing downstream
 * knows which side it asked (data/aio.ts picks).
 *
 * Two rules from plan 023 hold here. A single item is only ever asked with
 * `Fields` and never with `MediaSources`: without `Fields`, AIOStreams runs
 * its whole stream search for a film or an episode, the same work as pressing
 * play (the native guard refuses it as well). The search is `aioSources`
 * and nothing else.
 */

import {
  isSeriesType,
  type AddonManifest,
  type CatalogDef,
  type CatalogResponse,
  type MetaPreview,
  type MetaResponse,
  type StreamResponse,
} from "../../data/stremio";
import { aioCall, aioSources } from "./account";
import { catalogOf, metaDetailOf, metaPreviewOf, SEARCH_CATALOGS, streamsOf } from "./browse";
import type { SignInConn } from "./conn";
import { jellyfinIdFor, rememberIds } from "./idmap";
import { blammyId, unpack } from "./ids";
import type { BaseItem } from "./rules";

/** Titles per catalog page when the caller names no number: Discover's
 * grid pages and its searches. Stream's rows ask for the row size. AIOStreams
 * answers at most 250 (its `maxCatalogItems` default, library.ts
 * `browseLimit`), and walks the addon's pages to fill what is asked. */
const PAGE = 40;
const PAGE_MAX = 250;

/** `/Shows/{id}/Episodes` answers 1000 unasked and 2000 at most
 * (library.ts); a longer show is read in pages of the most. */
const EPISODES_LIMIT = 2000;
const EPISODES_PAGES = 5;

/** What a single title is asked for. Never `MediaSources`. */
const ITEM_FIELDS = "Overview,Genres,People,Path,ProviderIds";

/** How long the catalog list is held. A Stream build, Discover and the hero
 * picker each ask for it, and the build itself is kept for 30 minutes
 * (stream/source.ts). */
const VIEWS_TTL_MS = 5 * 60_000;

const BUSY = "AIOStreams is busy. Try again in a few seconds.";

interface List<T> {
  Items?: T[];
  TotalRecordCount?: number;
}

/** What went wrong with an answer, said without an address in it. */
function failure(status: number, what: string): Error {
  if (status === 401) return new Error("Signed out of AIOStreams");
  if (status === 429) return new Error(BUSY);
  return new Error(`AIOStreams answered ${status || "nothing"} for ${what}`);
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

interface Views {
  defs: CatalogDef[];
  /** `type`, `id` → the view's Jellyfin id. */
  ids: Map<string, string>;
  /** The views whose genre is required, with their genres, for the one a
   * caller asks for by "None". */
  required: Map<string, string[]>;
}

const viewKey = (type: string, id: string) => `${type}\u0000${id}`;

async function fetchViews(): Promise<Views> {
  const r = await aioCall<List<BaseItem>>("GET", "/UserViews");
  if (!Array.isArray(r.data?.Items)) throw failure(r.status, "your catalogs");
  const views = r.data.Items;
  const defs: CatalogDef[] = [];
  const ids = new Map<string, string>();
  const required = new Map<string, string[]>();
  const built = await Promise.all(
    views.map(async (view) => {
      const bare = catalogOf(view);
      if (!bare || !view.Id) return null;
      // Discover's genre filter needs the options, and only for the types it
      // browses.
      let genres: string[] | undefined;
      if (bare.type === "movie" || bare.type === "series") {
        const g = await aioCall<List<BaseItem>>("GET", "/Genres", { query: { ParentId: view.Id } }).catch(() => null);
        genres = (g?.data?.Items ?? []).flatMap((i) => (typeof i.Name === "string" && i.Name ? [i.Name] : []));
      }
      return { view, def: catalogOf(view, genres) as CatalogDef, genres: genres ?? [] };
    }),
  );
  for (const b of built) {
    if (!b || !b.view.Id) continue;
    defs.push(b.def);
    ids.set(viewKey(b.def.type, b.def.id), b.view.Id);
    if (b.view.aiostreams?.genreRequired === true) required.set(viewKey(b.def.type, b.def.id), b.genres);
  }
  return { defs, ids, required };
}

let held: { key: string; at: number; promise: Promise<Views> } | null = null;

function loadViews(conn: SignInConn): Promise<Views> {
  if (held && held.key === conn.key && Date.now() - held.at < VIEWS_TTL_MS) return held.promise;
  const mine = { key: conn.key, at: Date.now(), promise: fetchViews() };
  held = mine;
  // A failure is not worth holding.
  mine.promise.catch(() => {
    if (held === mine) held = null;
  });
  return mine.promise;
}

/** Let go of the held catalogs (tests, and a caller that knows they moved). */
export function forgetViews(): void {
  held = null;
}

/** The addon's manifest, as far as the app reads one: the catalogs, in the
 * config's order, and the search catalogs last (aioProbe reads `catalogs[0]`). */
export async function remoteManifest(conn: SignInConn): Promise<AddonManifest> {
  const { defs } = await loadViews(conn);
  return {
    id: "aiostreams.signin",
    name: "AIOStreams",
    resources: ["catalog", "meta", "stream"],
    catalogs: [...defs, ...SEARCH_CATALOGS],
  };
}

/** The Stremio extra segment (`genre=Action&skip=40`, `search=iron%20man`). */
function parseExtra(extra: string | undefined): { genre?: string; skip: number; search?: string } {
  const out: { genre?: string; skip: number; search?: string } = { skip: 0 };
  for (const part of (extra ?? "").split("&")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const raw = part.slice(at + 1);
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      /* not escaped: as it came */
    }
    const key = part.slice(0, at);
    if (key === "genre") out.genre = value;
    else if (key === "skip") out.skip = Math.max(0, Math.floor(Number(value)) || 0);
    else if (key === "search") out.search = value;
  }
  return out;
}

/** The kind of item each search catalog asks for (browse.ts `SEARCH_CATALOGS`). */
const SEARCH_TYPES: Record<string, string> = {
  [SEARCH_CATALOGS[0].id]: "Movie",
  [SEARCH_CATALOGS[1].id]: "Series",
};

/** What a list taught: each title's Stremio id, kind and Jellyfin id. */
function previews(conn: SignInConn, items: readonly BaseItem[]): MetaPreview[] {
  const metas: MetaPreview[] = [];
  const learned: [string, string, string][] = [];
  for (const item of items) {
    const m = metaPreviewOf(item, conn.base);
    if (!m) continue;
    metas.push(m);
    if (item.Id) learned.push([m.id, isSeriesType(m.type) ? "series" : "movie", item.Id]);
  }
  rememberIds(conn.base, learned);
  return metas;
}

/**
 * One catalog page. `extra` is the Stremio extra segment: `skip` is the page's
 * `StartIndex`, `genre` its `Genres`, and `search` (on a search catalog) its
 * `SearchTerm`. A catalog whose genre is required is asked for "None" by the
 * hero; AIOStreams answers nothing without a genre, so its first one stands
 * in, as it does for a Jellyfin client. `limit` is how many titles to ask
 * for; the default is a Discover page.
 */
export async function remoteCatalog(
  conn: SignInConn,
  type: string,
  id: string,
  extra?: string,
  limit: number = PAGE,
): Promise<CatalogResponse> {
  const x = parseExtra(extra);
  const n = String(Math.min(PAGE_MAX, Math.max(1, Math.floor(limit) || PAGE)));
  const searchType = SEARCH_TYPES[id];
  let query: Record<string, string>;
  if (searchType) {
    const term = x.search?.trim();
    if (!term) return { metas: [] };
    query = {
      SearchTerm: term,
      IncludeItemTypes: searchType,
      Recursive: "true",
      Limit: n,
      ...(x.skip > 0 ? { StartIndex: String(x.skip) } : {}),
    };
  } else {
    const views = await loadViews(conn);
    const key = viewKey(type, id);
    const parent = views.ids.get(key);
    if (!parent) throw new Error(`AIOStreams has no catalog "${id}"`);
    let genre = x.genre?.trim();
    if (genre && genre.toLowerCase() === "none") genre = undefined;
    if (!genre) genre = views.required.get(key)?.[0];
    query = {
      ParentId: parent,
      StartIndex: String(x.skip),
      Limit: n,
      ...(genre ? { Genres: genre } : {}),
    };
  }
  const r = await aioCall<List<BaseItem>>("GET", "/Items", { query });
  if (!Array.isArray(r.data?.Items)) throw failure(r.status, "a catalog");
  return { metas: previews(conn, r.data.Items) };
}

// ---------------------------------------------------------------------------
// A title
// ---------------------------------------------------------------------------

/** A show's episodes, all of them: read in pages when it has more than the
 * server answers at once. */
async function episodesOf(seriesId: string): Promise<BaseItem[]> {
  const out: BaseItem[] = [];
  for (let page = 0; page < EPISODES_PAGES; page++) {
    const r = await aioCall<List<BaseItem>>("GET", `/Shows/${seriesId}/Episodes`, {
      query: { Limit: String(EPISODES_LIMIT), StartIndex: String(out.length) },
    });
    if (!Array.isArray(r.data?.Items)) throw failure(r.status, "this show's episodes");
    out.push(...r.data.Items);
    const total = r.data.TotalRecordCount ?? out.length;
    if (r.data.Items.length === 0 || out.length >= total) break;
  }
  return out;
}

/**
 * A title's full detail. The id is looked up, then computed (idmap.ts); a
 * title it cannot name, or one AIOStreams does not have, answers with no
 * meta, as an addon without it would. A show also reads its episodes, unless
 * `episodes` is false, for a caller that only wants the art.
 */
export async function remoteMeta(
  conn: SignInConn,
  type: string,
  id: string,
  opts: { episodes?: boolean } = {},
): Promise<MetaResponse> {
  const jid = jellyfinIdFor(conn.base, type, id);
  if (!jid) return {};
  const r = await aioCall<BaseItem>("GET", `/Items/${jid}`, { query: { Fields: ITEM_FIELDS } });
  if (r.status === 404) return {};
  if (!r.data) throw failure(r.status, "this title");
  const item = r.data;
  const episodes =
    item.Type === "Series" && opts.episodes !== false ? await episodesOf(item.Id ?? jid) : [];
  const meta = metaDetailOf(item, episodes, conn.base);
  if (!meta) return {};
  // What the title and its episodes taught: an episode's packed id depends on
  // a season only the episode list knows for a Kitsu-style show, so the ones
  // that do not compute are kept.
  const learned: [string, string, string][] = [];
  if (item.Id) learned.push([meta.id, isSeriesType(meta.type) ? "series" : "movie", item.Id]);
  for (const ep of episodes) {
    const packed = unpack(ep.Id);
    const videoId = packed ? blammyId(packed) : null;
    if (videoId && ep.Id) learned.push([videoId, "series", ep.Id]);
  }
  rememberIds(conn.base, learned);
  return { meta };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * A title's or episode's sources: the stream search, as the Stremio side's
 * `/stream` answers it. `refresh` searches the addons again, else a list from
 * the last 3 minutes is taken as it is (the native side asks `Fresh`). None
 * found is an empty list; a rate limit is an error that says so.
 */
export async function remoteStreams(
  conn: SignInConn,
  type: string,
  id: string,
  opts: { refresh?: boolean } = {},
): Promise<StreamResponse> {
  const jid = jellyfinIdFor(conn.base, type, id);
  if (!jid) return { streams: [] };
  const r = await aioSources(jid, !!opts.refresh);
  if (r.status === 404) return { streams: [] };
  if (r.status < 200 || r.status >= 300) throw failure(r.status, "sources");
  if (r.errorCode) return { streams: [] };
  return { streams: streamsOf(r.sources) };
}
