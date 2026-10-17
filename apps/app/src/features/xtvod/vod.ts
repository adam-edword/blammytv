/**
 * An Xtream playlist's movies and shows as Stream's rows, and a title's page
 * and files on demand (plan 028): the page's side of what library.ts, pages.ts
 * and sources.ts describe. The sibling of jellyfin/vod.ts, built to the same
 * rules: every playlist is best-effort and a bad one never sinks the tab.
 *
 * One list, many views. A playlist's whole movie list and show list are read
 * once, kept (memory, then disk) and built into a library (library.ts); the
 * rows, the hero, a title's copies and a title's page are all views of that,
 * so a folder pick costs no call at all. Per-title calls happen only when a
 * page opens.
 *
 * Nothing here is merged with another source's catalog. Every item carries
 * `from: "xt"`, and the resolvers below are only asked for such an item
 * (stream/source.ts routes on it).
 */

import {
  fetchSeries,
  fetchSeriesCategories,
  fetchSeriesInfo,
  fetchVodCategories,
  fetchVodInfo,
  fetchVodStreams,
} from "../../data/xtream";
import { scrubbedMessage } from "../../lib/errors";
import { cleanUserAgent } from "../../lib/userAgent";
import { loadShowAdult } from "../settings/adultFilter";
import { loadPlaylists, onPlaylistsChange, type XtreamPlaylist } from "../settings/playlists";
import { loadRowCap } from "../settings/rowCap";
import { mapStreams } from "../stream/mapper";
import type { StreamRow, StreamSource, VodData, VodItem } from "../stream/model";
import { digest, diskClearAll, diskDrop, diskGet, diskPut, fingerprint } from "./disk";
import { readKey, titleOf, type XtKind } from "./keys";
import { feedOf, pageOf, searchTitles } from "./discover";
import { buildLibrary, type XtLibrary, type XtLists, type XtTitle } from "./library";
import { movieFromInfo, showFromInfos } from "./pages";
import { readMovies, readShows } from "./read";
import { readSeriesInfo, type XtSeriesInfo } from "./series";
import { episodeStreams, movieStreams } from "./sources";
import { dropXtFor, eligiblePlaylists, loadPicks, saveHeld, XT_CHANGED } from "./store";

const msg = scrubbedMessage;

/**
 * How long a read of the lists is used as it is: 12 hours, the guide's own
 * rhythm (live/epgWindow.ts GUIDE_REFRESH_MS). They are the same kind of
 * download (one provider's movie list is 10.2 MB and took 4.1 s on a fast
 * line) and change at the same pace, a few titles a day. A launch inside it
 * makes no list call at all; past it, the last read is shown at once and
 * read again behind it.
 */
export const LISTS_TTL_MS = 12 * 3600_000;

/** After a refresh fails, how long before the next launch of the app (or the
 * next ask) tries again while the last read is being shown. A person who has
 * no read to show is never held off: Retry has to retry. */
const RETRY_AFTER_FAIL_MS = 5 * 60_000;

/** How long a show's episode lists are kept for the session, so opening an
 * episode after its page does not read them again. Stream's own catalog TTL. */
const INFO_TTL_MS = 30 * 60_000;

/** The hero's size, as stream/source.ts keeps it. */
const FEATURED_TOTAL = 9;

/** How long a burst of changes has to be quiet before the library loads, as
 * Live waits to reload its catalog on a playlist save (live/source.ts). */
const SETTLE_MS = 800;

/** Said when the lists in memory changed: read from disk, or read again from
 * the panel. (A pick or the switch is `XT_CHANGED`, store.ts.) */
export const XT_LOADED = "blammytv:xt-loaded";

// ---------------------------------------------------------------------------
// The lists, per playlist
// ---------------------------------------------------------------------------

interface Mem {
  /** The account these were read from (disk.ts `fingerprint`). Never logged. */
  fp: string;
  at: number;
  lists: XtLists;
}

const mem = new Map<string, Mem>();
/** Bumped whenever the lists in memory change: what a derived build is keyed by
 * beside the choices. */
let epoch = 0;

/** One ask at a time per playlist, disk read and decision included. */
const flights = new Map<string, { fp: string; promise: Promise<Mem> }>();
/** One read of the panel at a time per playlist. */
const refreshing = new Map<string, { fp: string; promise: Promise<Mem> }>();
const failedAt = new Map<string, number>();

/** Younger than the TTL. A read stamped in the future (the clock was set back)
 * is not fresh, it is unknowable. */
const fresh = (at: number): boolean => {
  const age = Date.now() - at;
  return age >= 0 && age < LISTS_TTL_MS;
};

const heldOff = (pid: string): boolean => Date.now() - (failedAt.get(pid) ?? -Infinity) < RETRY_AFTER_FAIL_MS;

const atFp = (pid: string, fp: string): Mem | undefined => {
  const m = mem.get(pid);
  return m && m.fp === fp ? m : undefined;
};

/** Whether this is still the playlist, as saved, the ask was made for: it can
 * be edited or removed while the panel answers. */
const stillCurrent = (p: XtreamPlaylist, fp: string): boolean =>
  eligiblePlaylists().some((q) => q.id === p.id && fingerprint(q) === fp);

function adopt(p: XtreamPlaylist, m: Mem): void {
  mem.set(p.id, m);
  epoch++;
  saveHeld(p.id, { movies: m.lists.movies.length, shows: m.lists.shows.length });
  window.dispatchEvent(new Event(XT_LOADED));
}

/** Both lists and both folder lists, as read. All or nothing: a panel that
 * errors on one of them (rather than answering `[]`) has no library until it
 * does not. shortcut: split the movie half from the show half if a panel
 * turns up that serves one and fails the other. */
async function fetchLists(p: XtreamPlaylist): Promise<XtLists> {
  const [movies, shows, movieFolders, showFolders] = await Promise.all([
    fetchVodStreams(p),
    fetchSeries(p),
    fetchVodCategories(p),
    fetchSeriesCategories(p),
  ]);
  return { movies: readMovies(movies), shows: readShows(shows), movieFolders, showFolders };
}

function refresh(p: XtreamPlaylist, fp: string): Promise<Mem> {
  const run = refreshing.get(p.id);
  if (run && run.fp === fp) return run.promise;
  const t0 = Date.now();
  const promise = fetchLists(p).then(
    (lists) => {
      const m: Mem = { fp, at: Date.now(), lists };
      failedAt.delete(p.id);
      console.info(
        `[xt-vod] read ${lists.movies.length} movies and ${lists.shows.length} shows in ${Date.now() - t0}ms (${digest(fp)})`,
      );
      if (stillCurrent(p, fp)) {
        adopt(p, m);
        void diskPut(p.id, fp, m.at, lists);
      }
      return m;
    },
    (err) => {
      failedAt.set(p.id, Date.now());
      console.warn(`[xt-vod] read failed (${digest(fp)}): ${msg(err)}`);
      throw err;
    },
  );
  const record = { fp, promise };
  refreshing.set(p.id, record);
  const clear = () => {
    if (refreshing.get(p.id) === record) refreshing.delete(p.id);
  };
  promise.then(clear, clear);
  return promise;
}

/**
 * The playlist's lists, once there are some to show: memory, then the disk
 * copy, then the panel, when there is no copy or it is past the TTL. A copy
 * past the TTL is handed back at once and read again behind it (the guide's
 * stale-while-revalidate), and a read that fails then keeps it. Rejects when
 * there is nothing to show and the panel could not be read.
 */
function ensure(p: XtreamPlaylist): Promise<Mem> {
  const fp = fingerprint(p);
  const have = atFp(p.id, fp);
  if (have && fresh(have.at)) return Promise.resolve(have);
  const run = flights.get(p.id);
  if (run && run.fp === fp) return run.promise;

  const promise = (async (): Promise<Mem> => {
    let kept = atFp(p.id, fp);
    if (!kept) {
      const d = await diskGet(p.id, fp);
      kept = atFp(p.id, fp);
      if (!kept && d && stillCurrent(p, fp)) {
        kept = { fp, at: d.at, lists: d.lists };
        adopt(p, kept);
      }
    }
    if (kept && fresh(kept.at)) return kept;
    if (kept) {
      if (!heldOff(p.id)) refresh(p, fp).catch(() => {});
      return kept;
    }
    return refresh(p, fp);
  })();
  const record = { fp, promise };
  flights.set(p.id, record);
  const clear = () => {
    if (flights.get(p.id) === record) flights.delete(p.id);
  };
  promise.then(clear, clear);
  return promise;
}

// ---------------------------------------------------------------------------
// The libraries, built from the lists
// ---------------------------------------------------------------------------

const built = new Map<string, { m: Mem; hide: boolean; lib: XtLibrary }>();

/** A playlist's library, built once per read of its lists and per setting of
 * the adult filter (settings/adultFilter.ts). */
function libraryOf(p: XtreamPlaylist, m: Mem): XtLibrary {
  const hide = !loadShowAdult();
  const hit = built.get(p.id);
  if (hit && hit.m === m && hit.hide === hide) return hit.lib;
  const lib = buildLibrary(p.id, m.lists, hide);
  built.set(p.id, { m, hide, lib });
  return lib;
}

interface Live {
  p: XtreamPlaylist;
  lib: XtLibrary;
}

/** The libraries Stream can draw right now: eligible playlists whose lists are
 * in memory, and that hold a title (a playlist that is live TV only has no
 * library to show or to pick from). In playlist order. */
function libraries(): Live[] {
  const out: Live[] = [];
  for (const p of eligiblePlaylists()) {
    const m = atFp(p.id, fingerprint(p));
    if (!m) continue;
    const lib = libraryOf(p, m);
    if (lib.titles.size > 0) out.push({ p, lib });
  }
  return out;
}

/** What identifies the build a screen is showing: the eligible playlists (their
 * account as a digest, never the account), their picks, the row size and the
 * adult filter. Empty with no eligible playlist. Moves whenever what Stream
 * would draw from the same lists moves. */
export const xtVodKey = (): string => {
  const ps = eligiblePlaylists();
  if (ps.length === 0) return "";
  return JSON.stringify([
    ps.map((p) => [p.id, p.name, digest(fingerprint(p)), loadPicks(p.id, "movie"), loadPicks(p.id, "series")]),
    loadRowCap(),
    loadShowAdult(),
  ]);
};

const EMPTY = (): VodData => ({ items: new Map(), rows: [], featured: [] });

/** A folder's titles, newest first (the panel's order among those added
 * together): a row of the first forty of a folder of thousands is the newest
 * forty, not whichever the panel happens to list first. */
const newestFirst = (lib: XtLibrary, keys: readonly string[]): string[] =>
  [...keys].sort((a, b) => (lib.titles.get(b)?.added ?? 0) - (lib.titles.get(a)?.added ?? 0));

const KIND_WORD: Record<XtKind, string> = { movie: "Movies", series: "Shows" };

/**
 * A row's title: the folder's name. Two playlists can each have an "Action", so
 * with more than one library the playlist's name follows it ("Action · My
 * Provider"), and a movie folder and a show folder of one playlist can share a
 * name ("Comedy"), so then the kind follows it ("Comedy · Movies").
 */
function rowTitle(folder: string, kind: XtKind, clash: boolean, playlist: string | null): string {
  return [folder, clash ? KIND_WORD[kind] : null, playlist].filter(Boolean).join(" · ");
}

let memo: { k: string; data: VodData } | null = null;

/** What Stream draws from the libraries in memory: the picked folders as rows
 * (movies, then shows, each in the panel's folder order), the hero, and every
 * title for Continue Watching and My List to open. */
function derive(libs: Live[]): VodData {
  const k = `${xtVodKey()}|${epoch}`;
  if (memo && memo.k === k) return memo.data;

  const cap = loadRowCap();
  const several = libs.length > 1;
  const items = new Map<string, VodItem>();
  const rows: StreamRow[] = [];
  const showKeys: { key: string; added: number }[] = [];
  for (const { p, lib } of libs) {
    for (const [key, t] of lib.titles) items.set(key, t.item);
    const sides = [
      { kind: "movie", folders: lib.movieFolders },
      { kind: "series", folders: lib.showFolders },
    ] as const;
    const picked = sides.map((s) => ({ ...s, on: new Set(loadPicks(p.id, s.kind)) }));
    const names = picked.flatMap((s) => s.folders.filter((f) => s.on.has(f.id)).map((f) => f.name.trim().toLowerCase()));
    for (const s of picked)
      for (const f of s.folders) {
        if (!s.on.has(f.id)) continue;
        const keys = newestFirst(lib, f.keys);
        if (keys.length === 0) continue;
        const clash = names.filter((n) => n === f.name.trim().toLowerCase()).length > 1;
        rows.push({
          id: `xt:${p.id}:${s.kind}:${f.id}`,
          title: rowTitle(f.name, s.kind, clash, several ? p.name : null),
          layout: "poster",
          itemIds: keys.slice(0, cap),
        });
        if (s.kind === "series") for (const key of keys) showKeys.push({ key, added: lib.titles.get(key)?.added ?? 0 });
      }
  }

  // The hero: the newest picked shows that have a backdrop, each once. None when
  // no show folder is picked.
  const seen = new Set<string>();
  const featured = showKeys
    .sort((a, b) => b.added - a.added)
    .filter(({ key }) => {
      if (seen.has(key) || !items.get(key)?.backdrop) return false;
      seen.add(key);
      return true;
    })
    .slice(0, FEATURED_TOTAL)
    .map(({ key }) => key);

  const data: VodData = { items, rows, featured };
  memo = { k, data };
  return data;
}

/** What Stream would draw from the libraries already in memory, or null when
 * none is (the first launch, before the lists have been read). Any age. */
export function peekXtVod(): VodData | null {
  const libs = libraries();
  return libs.length > 0 ? derive(libs) : null;
}

/**
 * The libraries as Stream's rows. Resolves to an empty build with no eligible
 * playlist, and to one with `error` when no playlist's lists could be read at
 * all. A playlist that could not be read never sinks the others.
 */
export async function loadXtVod(): Promise<VodData> {
  const ps = eligiblePlaylists();
  if (ps.length === 0) return EMPTY();
  const results = await Promise.allSettled(ps.map(ensure));
  const libs = libraries();
  if (libs.length > 0) return derive(libs);
  // Nothing to draw. Read, with nothing in it (live TV only), is an empty
  // build; unread is the error.
  const bad = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  return bad ? { ...EMPTY(), error: msg(bad.reason) } : EMPTY();
}

/** A library as the folder picker draws it: the folders to offer, not the
 * picks (store.ts). */
export interface XtLibraryView {
  id: string;
  name: string;
  movieFolders: { id: string; name: string }[];
  showFolders: { id: string; name: string }[];
}

/** The libraries in memory with their folders, in playlist order. A folder with
 * no title in it is not offered: picking it would add no row. Adult folders
 * are not offered while adult content is hidden (library.ts leaves them out). */
export function xtLibraries(): XtLibraryView[] {
  const offered = (fs: readonly { id: string; name: string; keys: string[] }[]) =>
    fs.filter((f) => f.keys.length > 0).map(({ id, name }) => ({ id, name }));
  return libraries().map(({ p, lib }) => ({
    id: p.id,
    name: p.name,
    movieFolders: offered(lib.movieFolders),
    showFolders: offered(lib.showFolders),
  }));
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

/** A library's Movies or Shows feed as Discover names a catalog: its kind and its
 * playlist's id. */
export interface XtCat {
  type: XtKind;
  id: string;
}

/**
 * The feeds Discover can browse: one Movies and one Shows catalog per library that
 * has some (discover.ts). A library with no movies has no Movies catalog. Waits
 * for the playlists' lists to be read unless `wait` is false, which is for when
 * something else can fill Discover meanwhile: a first read of a big list takes
 * seconds, and a panel that hangs takes two minutes (data/xtream.ts), and that
 * must not hold back the addon's catalogs. The read still starts, and says so
 * (`XT_LOADED`) when the libraries land. Never rejects: a playlist whose lists
 * could not be read has no library, which is the same as having no movies, and
 * `ensure` has said why in the log.
 */
export async function loadXtDiscover(wait = true): Promise<XtCat[]> {
  const reads = Promise.allSettled(eligiblePlaylists().map(ensure));
  if (wait) await reads;
  return libraries().flatMap(({ p, lib }) =>
    (["movie", "series"] as const).filter((type) => feedOf(lib, type).length > 0).map((type) => ({ type, id: p.id })),
  );
}

/** One page of a catalog's feed, past `skip` titles. Read from the library in
 * memory as it stands, so a library switched off since is an empty page. */
export function xtPage(cat: XtCat, skip: number): VodItem[] {
  const hit = libraries().find(({ p }) => p.id === cat.id);
  return hit ? pageOf(feedOf(hit.lib, cat.type), skip) : [];
}

/** A search over every library that is on, for one kind (discover.ts). */
export async function searchXt(type: XtKind, query: string): Promise<VodItem[]> {
  return searchTitles(
    libraries().map(({ lib }) => lib),
    type,
    query,
  );
}

/** What names the feeds Discover would draw, for a snapshot of it to be matched
 * against: each library that is on and read (its account as a digest, never the
 * account) and which kinds it has. Empty with none. Unlike `xtVodKey` it does not
 * move with a pick, the row size or the lists being read again: the feeds are
 * the whole library. */
export const xtDiscoverKey = (): string => {
  const libs = libraries();
  if (libs.length === 0) return "";
  return JSON.stringify(
    libs.map(({ p, lib }) => [p.id, digest(fingerprint(p)), feedOf(lib, "movie").length > 0, feedOf(lib, "series").length > 0]),
  );
};

/**
 * Load the libraries at launch, so the record of what each held fills and
 * Stream is ready before it is visited, and again when what they depend on
 * changes: the playlists (a save, or the adult filter, which says so through
 * the same signal) and the switch or a pick. Cheap when everything is in
 * memory and young. App mounts this once.
 */
export function watchXtLibrary(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void loadXtVod().catch(() => {}), ms);
  };
  soon(0);
  const again = () => soon(SETTLE_MS);
  const off = onPlaylistsChange(() => {
    forgetRemoved();
    again();
  });
  window.addEventListener(XT_CHANGED, again);
  return () => {
    off();
    window.removeEventListener(XT_CHANGED, again);
    clearTimeout(timer);
  };
}

/**
 * A playlist taken out of Settings takes its library with it: its choices and
 * its record of what it held (store.ts), its lists on disk and the ones in
 * memory. Run on every save of the playlist list, which is how a deleted
 * playlist takes its guide fixes (settings/playlists.ts `savePlaylists`). It is
 * not called from there: store.ts reads the playlists, and the two would import
 * each other.
 */
export function forgetRemoved(): void {
  const keep = new Set(loadPlaylists().map((p) => p.id));
  for (const id of dropXtFor(keep)) void diskDrop(id);
  for (const id of [...mem.keys()])
    if (!keep.has(id)) {
      mem.delete(id);
      built.delete(id);
      epoch++;
    }
}

/**
 * Forget every playlist's lists, in memory and on disk: Clear All Login Info
 * (settings/AppPage.tsx). The lists hold no credential, but each copy is kept
 * under its account's fingerprint (server, user name and password).
 */
export function forgetXtLists(): Promise<void> {
  mem.clear();
  built.clear();
  infos.clear();
  failedAt.clear();
  memo = null;
  epoch++;
  return diskClearAll();
}

// ---------------------------------------------------------------------------
// One title
// ---------------------------------------------------------------------------

const GONE = "This title isn’t in your playlist’s library.";

interface Located {
  p: XtreamPlaylist;
  title: XtTitle;
}

/** The playlist and the library's title a key names. Waits for the library
 * (a Continue Watching click on a cold launch). Null when the key is not one,
 * its playlist is gone or switched off, or the library does not hold it. */
async function locate(key: string): Promise<Located | null> {
  const k = readKey(key);
  const titleId = titleOf(key);
  if (!k || !titleId) return null;
  const p = eligiblePlaylists().find((x) => x.id === k.playlistId);
  if (!p) return null;
  const m = await ensure(p);
  const title = libraryOf(p, m).titles.get(titleId);
  return title ? { p, title } : null;
}

const infos = new Map<string, { at: number; promise: Promise<XtSeriesInfo[]> }>();

/** The episodes of every copy of a show, read in parallel, kept for the session.
 * A copy that cannot be read is left out, so a 4K copy that fails does not
 * hide the plain one; it rejects only when none could be read, and a partial
 * answer is not kept, so the next ask reads the missing copy again. The
 * concurrent asks of one open (the page and the file list) share one read. */
function showInfos(p: XtreamPlaylist, title: Extract<XtTitle, { kind: "series" }>): Promise<XtSeriesInfo[]> {
  const ck = `${p.id}|${digest(fingerprint(p))}|${title.key}`;
  const hit = infos.get(ck);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.promise;
  const promise = Promise.allSettled(
    title.copies.map(async (c) => readSeriesInfo(c, await fetchSeriesInfo(p, c.id))),
  ).then((rs) => {
    const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (ok.length === 0) throw (rs[0] as PromiseRejectedResult).reason;
    if (ok.length < rs.length && infos.get(ck)?.promise === promise) infos.delete(ck);
    return ok;
  });
  infos.set(ck, { at: Date.now(), promise });
  promise.catch(() => {
    if (infos.get(ck)?.promise === promise) infos.delete(ck);
  });
  return promise;
}

/** A film or show's page, from the panel. Null when the key names nothing in
 * the library. Under the key it was asked for. */
export async function resolveXtItem(key: string): Promise<VodItem | null> {
  if (readKey(key)?.season !== undefined) return null; // an episode is not a title
  const hit = await locate(key);
  if (!hit) return null;
  const { p, title } = hit;
  if (title.kind === "movie") return movieFromInfo(title.item, await fetchVodInfo(p, title.copies[0].id));
  return showFromInfos(title.item, await showInfos(p, title));
}

export interface XtList {
  sources: StreamSource[];
  notices: string[];
}

/**
 * The files the provider holds for a film or an episode, as Stream's sources:
 * one per copy, the best quality first. A film's are built from the library; an
 * episode's need its show's episode lists (`showInfos`). Nothing is searched.
 */
export async function resolveXtList(kind: XtKind, key: string): Promise<XtList> {
  const k = readKey(key);
  if (!k || k.kind !== kind) return { sources: [], notices: [] };
  const hit = await locate(key);
  if (!hit) return { sources: [], notices: [GONE] };
  const { p, title } = hit;
  // A film's key has no season (keys.ts), so this is every one of its copies.
  if (title.kind === "movie") return { sources: mapStreams(movieStreams(p, title.copies)), notices: [] };
  // A show has no file of its own: only its episodes do.
  if (k.season === undefined || k.episode === undefined) return { sources: [], notices: [] };
  const read = await showInfos(p, title);
  return { sources: mapStreams(episodeStreams(p, read, k.season, k.episode)), notices: [] };
}

/** The User-Agent the key's playlist asks its panel with, which mpv must send
 * too (data/xtream.ts rides it on every call), or undefined for the app's own. */
export function xtUserAgent(key: string): string | undefined {
  const k = readKey(key);
  const p = k && loadPlaylists().find((x) => x.id === k.playlistId && x.kind === "xtream");
  return p ? cleanUserAgent(p.userAgent) : undefined;
}
