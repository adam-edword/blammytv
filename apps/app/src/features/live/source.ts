import {
  authenticate,
  fetchLiveCategories,
  fetchLiveStreams,
  fetchXmltv,
  type XtreamCategory,
  type XtreamStream,
} from "../../data/xtream";
import {
  loadPlaylists,
  type XtreamPlaylist,
} from "../settings/playlists";
import { loadShowAdult } from "../settings/adultFilter";
import { isAdultCategory, isAdultStream } from "./adult";
import { diskGet, diskPut } from "./diskCache";
import { mockLive } from "./mock";
import type { Channel, LiveData, LiveGroup, Programme } from "./model";
import { extractQuality } from "./quality";
import { parseXmltv } from "./xmltv";

/**
 * The seam between the Live tab and where its data comes from. With no
 * enabled playlists the bundled mock catalog loads instead, so the tab is
 * always a working dev harness. Real sources follow the old build's proven
 * strategy: everything is fetched up front (categories + all streams in two
 * calls, then the full XMLTV document), and each playlist is best-effort —
 * one failing source (or its EPG) never sinks the others.
 *
 * `onStage` narrates progress for the loading screen — big playlists spend
 * real time in each stage, and a stalled label tells us exactly which one
 * wedged. Timings land on the console for the same reason.
 */
/** Session cache: switching tabs unmounts the Live screen, and refetching
 * a 90MB playlist on every remount is absurd. Keyed by the playlist
 * configs (so a Settings change misses naturally) and aged out on the
 * guide's half-hour rhythm. In-memory only — a fresh app launch always
 * fetches. */
const CACHE_TTL_MS = 30 * 60_000;
let cache: { key: string; at: number; data: LiveData } | null = null;

/** Single-flight guard: the cache is only written AFTER a load completes, so
 * two concurrent loadLive calls both missed it and each fetched + parsed the
 * full pipeline (~95MB xmltv, twice — StrictMode's dev double-effect made
 * this the norm, and mount racing the playlists-change debounce can do it in
 * prod). Joiners share the in-flight promise; their onStage callbacks fan in
 * so the loading label still narrates for whichever caller renders. */
let inflight: {
  key: string;
  promise: Promise<LiveData>;
  stages: Set<(label: string) => void>;
} | null = null;

/** How old a DISK snapshot may be and still hydrate the guide instantly.
 * The EPG we keep covers fetch−1h..fetch+12h, and the guide window shows
 * now..now+4h — at 8h old the cached listings still fill the whole window
 * while the background refresh replaces them. */
const DISK_MAX_AGE_MS = 8 * 3600_000;

/** Fired after a BACKGROUND refresh lands fresh data in the memory cache —
 * the Live screen re-reads it silently (same path as playlist edits). */
const REFRESHED_EVENT = "blammytv:live-refreshed";
export function onLiveRefreshed(cb: () => void): () => void {
  window.addEventListener(REFRESHED_EVENT, cb);
  return () => window.removeEventListener(REFRESHED_EVENT, cb);
}

/** Persist off the critical path: a structured-clone write of a ~15MB graph
 * costs real main-thread time, so let the first paint settle first. */
function scheduleDiskPut(key: string, at: number, data: LiveData) {
  setTimeout(() => {
    void diskPut({ key, at, data });
  }, 1500);
}

/** Revalidate a disk hydration: run the real load without blocking the
 * caller, then announce so the screen swaps to fresh data in place. Called
 * only from inside the owning in-flight record's disk-hit branch; it
 * REPLACES that record in the single-flight slot, so the hydrating callers
 * keep their already-shared promise (resolving with disk data) while any
 * later caller joins the live revalidation instead. */
function refreshInBackground(playlists: XtreamPlaylist[], key: string) {
  const stages = new Set<(label: string) => void>();
  const promise = doLoad(playlists, key, new Date(), (label) =>
    stages.forEach((cb) => cb(label)),
  );
  const record = { key, promise, stages };
  inflight = record;
  promise
    .then((data) => {
      if (data.channels.length > 0)
        window.dispatchEvent(new CustomEvent(REFRESHED_EVENT));
    })
    .catch(() => {})
    .finally(() => {
      if (inflight === record) inflight = null;
    });
}

const enabledXtream = () =>
  loadPlaylists().filter(
    (p): p is XtreamPlaylist => p.enabled && p.kind === "xtream",
  );

const cacheKey = (playlists: XtreamPlaylist[]) =>
  playlists.length === 0
    ? "mock"
    : JSON.stringify([
        playlists.map((p) => [
          p.id,
          p.server,
          p.username,
          p.password,
          p.hiddenCategories ?? [],
        ]),
        // The adult filter changes what a load produces, so it's part of
        // the config fingerprint — flipping it misses cache + disk naturally.
        loadShowAdult(),
      ]);

/** The cached catalog, if it's still current — lets a remounting Live
 * screen render data in its very first frame, no loading state. */
export function peekLive(): LiveData | null {
  const key = cacheKey(enabledXtream());
  return cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS
    ? cache.data
    : null;
}

export async function loadLive(
  now: Date,
  onStage?: (label: string) => void,
  force = false,
): Promise<LiveData> {
  const playlists = enabledXtream();
  const key = cacheKey(playlists);
  if (!force && cache && cache.key === key) {
    if (Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
    cache = null;
  }

  // Join a matching load already in the air instead of doubling it. Forced
  // refreshes (playlist edits) start fresh — they exist to bypass stale work.
  if (!force && inflight && inflight.key === key) {
    if (onStage) inflight.stages.add(onStage);
    return inflight.promise;
  }

  // Claim the single-flight slot SYNCHRONOUSLY — the disk probe below awaits,
  // and that gap is exactly where a concurrent caller (StrictMode's double
  // effect) would slip past the join check and double the load.
  const stages = new Set<(label: string) => void>();
  if (onStage) stages.add(onStage);
  const record = {
    key,
    stages,
    promise: undefined as unknown as Promise<LiveData>,
  };
  record.promise = (async () => {
    // Disk hydrate (Telly-style instant start): a recent-enough snapshot from
    // a previous run renders NOW, and the real load revalidates behind it —
    // the screen swaps to fresh data via onLiveRefreshed. Config changes miss
    // naturally (the key fingerprints the playlists); mock never persists.
    if (!force && playlists.length > 0) {
      const disk = await diskGet(key).catch(() => null);
      if (disk && Date.now() - disk.at < DISK_MAX_AGE_MS) {
        cache = { key, at: disk.at, data: disk.data };
        refreshInBackground(playlists, key); // replaces this record's slot
        return disk.data;
      }
    }
    return doLoad(playlists, key, now, (label) =>
      stages.forEach((cb) => cb(label)),
    );
  })();
  inflight = record;
  try {
    return await record.promise;
  } finally {
    if (inflight === record) inflight = null;
  }
}

async function doLoad(
  playlists: XtreamPlaylist[],
  key: string,
  now: Date,
  onStage: (label: string) => void,
): Promise<LiveData> {
  let data: LiveData;
  if (playlists.length === 0) {
    data = mockLive(now);
  } else {
    data = { groups: [], channels: [], programmes: new Map() };
    // Stage narration is a single last-writer-wins label, so it only makes
    // sense for one source. With several enabled, they load concurrently and
    // would stomp each other's labels (showing a finished source while a
    // different one is the one actually wedged) — fall back to the generic
    // "Loading channels…" the caller shows when no stage is reported.
    const narrate = playlists.length === 1 ? onStage : undefined;
    const built = await Promise.all(
      playlists.map((p) => buildXtreamSource(p, now, narrate)),
    );
    // Assembled in saved-playlist order, not arrival order. concat, not
    // push(...spread): spreading a six-figure channel list overflows the
    // argument stack.
    for (const src of built) {
      data.groups.push(src.group);
      data.channels = data.channels.concat(src.channels);
      for (const [id, list] of src.programmes) data.programmes.set(id, list);
    }
  }

  // A total failure (no channels at all) stays uncached so the next mount
  // retries instead of pinning the error for half an hour. Real playlist
  // loads also persist to disk for the next launch's instant hydrate.
  if (data.channels.length > 0) {
    const at = Date.now();
    cache = { key, at, data };
    if (playlists.length > 0) scheduleDiskPut(key, at, data);
  }
  return data;
}

/** Yield a macrotask so the loading UI can paint between blocking stages
 * (huge playlists spend whole seconds in single JSON.parse / DOMParser
 * calls that nothing can interrupt). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

async function buildXtreamSource(
  p: XtreamPlaylist,
  now: Date,
  onStage?: (label: string) => void,
): Promise<{
  group: LiveGroup;
  channels: Channel[];
  programmes: Map<string, Programme[]>;
}> {
  try {
    onStage?.(`Signing in to ${p.name}…`);
    await authenticate(p);

    // Kick the guide download off NOW — it's the longest leg (tens of MB)
    // and needs nothing from categories/streams, which used to gate it.
    // Pre-attach a catch so a failure elsewhere can't surface it as an
    // unhandled rejection; the EPG block below awaits and handles it.
    const xmlT0 = performance.now();
    const xmlPromise = fetchXmltv(p);
    xmlPromise.catch(() => {});

    onStage?.(`Fetching ${p.name} channels…`);
    await breathe();
    const t = performance.now();
    const [cats, streams] = await Promise.all([
      fetchLiveCategories(p),
      fetchLiveStreams(p),
    ]);
    console.info(
      `[live] ${p.name}: ${cats.length} categories + ${streams.length} streams in ${Math.round(performance.now() - t)}ms`,
    );

    const showAdult = loadShowAdult();
    const hidden = droppedCategories(p, cats, showAdult);
    const folders = cats
      .filter((c) => !hidden.has(c.id))
      .map((c) => ({ id: folderId(p.id, c.id), name: c.name }));
    const channels = mapStreams(streams, p, hidden, !showAdult);

    // EPG is best-effort — channels still render "No Information" without it.
    let programmes = new Map<string, Programme[]>();
    try {
      onStage?.(`Downloading the ${p.name} TV guide…`);
      await breathe();
      const xml = await xmlPromise; // in flight since right after sign-in
      const fetched = performance.now();
      onStage?.(`Reading the ${p.name} TV guide…`);
      await breathe();
      programmes = parseXmltv(xml, epgIndex(streams, p, hidden, !showAdult), now);
      console.info(
        `[live] ${p.name}: xmltv ${(xml.length / 1e6).toFixed(1)}MB in ${Math.round(fetched - xmlT0)}ms (overlapped), parsed EPG for ${programmes.size} channels in ${Math.round(performance.now() - fetched)}ms`,
      );
    } catch (err) {
      console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
    }

    return { group: { id: p.id, name: p.name, folders }, channels, programmes };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      programmes: new Map(),
    };
  }
}

const folderId = (playlistId: string, catId: unknown) =>
  `${playlistId}:${String(catId ?? "")}`;
const channelId = (playlistId: string, streamId: number | string) =>
  `${playlistId}:${streamId}`;

/** The category ids a load drops: the user's hidden folders, plus — unless
 * adult content is shown — every category the panel flags `is_adult` or the
 * conservative name pattern catches (see adult.ts). */
export function droppedCategories(
  p: XtreamPlaylist,
  cats: XtreamCategory[],
  showAdult: boolean,
): Set<string> {
  const hidden = new Set(p.hiddenCategories ?? []);
  if (!showAdult) {
    for (const c of cats) if (isAdultCategory(c)) hidden.add(c.id);
  }
  return hidden;
}

/** Normalize raw panel streams into channels. Streams in a hidden category
 * drop out entirely — hiding a folder hides its content, not just the
 * sidebar row. Adult-flagged streams drop too unless the filter is off. */
export function mapStreams(
  streams: XtreamStream[],
  p: XtreamPlaylist,
  hidden: Set<string> = new Set(p.hiddenCategories ?? []),
  hideAdult = true,
): Channel[] {
  return streams
    .filter(
      (s) =>
        !hidden.has(String(s.category_id ?? "")) &&
        !(hideAdult && isAdultStream(s)),
    )
    .map((s) => {
      const name = s.name?.trim() || `Channel ${s.stream_id}`;
      return {
        id: channelId(p.id, s.stream_id),
        name,
        quality: extractQuality(name),
        folderId: folderId(p.id, s.category_id),
        logo: validUrl(s.stream_icon),
        archiveDays: archiveDaysOf(s),
      };
    });
}

/** Catch-up depth for a stream, in whole days (0 = no archive). The panel
 * sends both fields string-typed ("1", "3") and sometimes numeric, so coerce
 * and guard: a channel is only archived when tv_archive is truthy AND the
 * duration parses to a positive number. */
export function archiveDaysOf(s: XtreamStream): number {
  if (Number(s.tv_archive) !== 1) return 0;
  const days = Math.floor(Number(s.tv_archive_duration));
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** epg_channel_id → our channel ids (one feed can back several channels). */
export function epgIndex(
  streams: XtreamStream[],
  p: XtreamPlaylist,
  hidden: Set<string> = new Set(p.hiddenCategories ?? []),
  hideAdult = true,
): Map<string, string[]> {
  const byEpg = new Map<string, string[]>();
  for (const s of streams) {
    if (!s.epg_channel_id || hidden.has(String(s.category_id ?? ""))) continue;
    if (hideAdult && isAdultStream(s)) continue;
    const list = byEpg.get(s.epg_channel_id) ?? [];
    list.push(channelId(p.id, s.stream_id));
    byEpg.set(s.epg_channel_id, list);
  }
  return byEpg;
}

function validUrl(s?: string | null): string | undefined {
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
