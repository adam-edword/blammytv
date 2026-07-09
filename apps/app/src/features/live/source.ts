import {
  authenticate,
  fetchLiveCategories,
  fetchLiveStreams,
  fetchXmltv,
  type XtreamCategory,
  type XtreamStream,
} from "../../data/xtream";
import {
  fetchChannels as fetchStalkerChannels,
  fetchEpg as fetchStalkerEpg,
  fetchGenres as fetchStalkerGenres,
} from "../../data/stalker";
import {
  loadPlaylists,
  type M3uPlaylist,
  type StalkerPlaylist,
  type XtreamPlaylist,
} from "../settings/playlists";
import { loadShowAdult } from "../settings/adultFilter";
import { httpGetText } from "../../lib/http";
import { isAdultCategory, isAdultStream, nameLooksAdult } from "./adult";
import { diskGet, diskPut } from "./diskCache";
import { parseM3U } from "./m3u";
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
function refreshInBackground(playlists: LoadableSource[], key: string) {
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

/** Enabled sources: all three kinds load through the same pipeline. */
type LoadableSource = XtreamPlaylist | M3uPlaylist | StalkerPlaylist;
const enabledSources = (): LoadableSource[] =>
  loadPlaylists().filter((p) => p.enabled);

const cacheKey = (playlists: LoadableSource[]) =>
  playlists.length === 0
    ? "mock"
    : JSON.stringify([
        playlists.map((p) =>
          p.kind === "xtream"
            ? [p.id, p.server, p.username, p.password, p.hiddenCategories ?? []]
            : p.kind === "stalker"
              ? [p.id, p.portal, p.mac, p.hiddenCategories ?? []]
              : [p.id, p.url, p.hiddenCategories ?? []],
        ),
        // The adult filter changes what a load produces, so it's part of
        // the config fingerprint — flipping it misses cache + disk naturally.
        loadShowAdult(),
      ]);

/** The cached catalog, if it's still current — lets a remounting Live
 * screen render data in its very first frame, no loading state. */
export function peekLive(): LiveData | null {
  const key = cacheKey(enabledSources());
  return cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS
    ? cache.data
    : null;
}

export async function loadLive(
  now: Date,
  onStage?: (label: string) => void,
  force = false,
): Promise<LiveData> {
  const playlists = enabledSources();
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
  playlists: LoadableSource[],
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
      playlists.map((p) =>
        p.kind === "m3u"
          ? buildM3uSource(p, now, narrate)
          : p.kind === "stalker"
            ? buildStalkerSource(p, now, narrate)
            : buildXtreamSource(p, now, narrate),
      ),
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

    // EPG is best-effort — channels still render "No Information" without
    // it. Whatever goes wrong lands on group.epgError so an installed user
    // can read the reason in Settings → Playlists (the console is invisible
    // in a packaged build).
    let programmes = new Map<string, Programme[]>();
    let epgError: string | undefined;
    try {
      onStage?.(`Downloading the ${p.name} TV guide…`);
      await breathe();
      const xml = await xmlPromise; // in flight since right after sign-in
      const fetched = performance.now();
      onStage?.(`Reading the ${p.name} TV guide…`);
      await breathe();
      const index = epgIndex(streams, p, hidden, !showAdult);
      programmes = parseXmltv(xml, index, now);
      console.info(
        `[live] ${p.name}: xmltv ${(xml.length / 1e6).toFixed(1)}MB in ${Math.round(fetched - xmlT0)}ms (overlapped), parsed EPG for ${programmes.size} channels in ${Math.round(performance.now() - fetched)}ms`,
      );
      if (index.size === 0)
        epgError = "the panel's channels carry no EPG ids to match a guide";
      else if (programmes.size === 0)
        epgError = `the guide downloaded (${(xml.length / 1e6).toFixed(1)}MB) but matched none of the channels`;
    } catch (err) {
      epgError = `guide download failed — ${msg(err)}`;
      console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
    }

    return {
      group: { id: p.id, name: p.name, folders, ...(epgError ? { epgError } : {}) },
      channels,
      programmes,
    };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      programmes: new Map(),
    };
  }
}

/** M3U group with no group-title lands here (Xtream always has a category). */
const M3U_UNGROUPED = "Uncategorized";

/** Pull the `url-tvg` / `x-tvg-url` EPG link out of the `#EXTM3U` header —
 * the parser is entry-only, and this is a header attribute. First match
 * wins; a comma-separated list takes its first url. */
function m3uEpgUrl(text: string): string | undefined {
  const m = text.match(/#EXTM3U[^\n]*?(?:url-tvg|x-tvg-url)\s*=\s*"([^"]*)"/i);
  const first = m?.[1]?.split(",")[0]?.trim();
  return first && /^https?:\/\//i.test(first) ? first : undefined;
}

/** Stable 32-bit FNV-1a hash → base36, for channel ids when an M3U entry
 * carries no tvg-id. Keyed on the URL so favorites/recents survive reloads. */
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Build a source from an M3U playlist: one text download, parsed into
 * channels grouped by `group-title`. EPG is best-effort via the header's
 * `url-tvg` (reusing the XMLTV pipeline, matched on `tvg-id`); without it
 * channels render No-Information lanes, exactly like an Xtream source whose
 * EPG failed. Adult groups + user-hidden groups drop by group name. */
async function buildM3uSource(
  p: M3uPlaylist,
  now: Date,
  onStage?: (label: string) => void,
): Promise<{
  group: LiveGroup;
  channels: Channel[];
  programmes: Map<string, Programme[]>;
}> {
  try {
    onStage?.(`Downloading ${p.name}…`);
    const t = performance.now();
    const text = await httpGetText(p.url);
    await breathe();
    onStage?.(`Reading ${p.name}…`);
    const entries = parseM3U(text);
    console.info(
      `[live] ${p.name}: ${entries.length} M3U entries in ${Math.round(performance.now() - t)}ms`,
    );

    const showAdult = loadShowAdult();
    const userHidden = new Set(p.hiddenCategories ?? []);
    const isHidden = (group: string) =>
      userHidden.has(group) || (!showAdult && nameLooksAdult(group));

    // Distinct groups in first-appearance order (folders), skipping hidden.
    const folders: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    const epgIdx = new Map<string, string[]>();
    const channels: Channel[] = [];
    // tvg-id is the EPG feed id and is legitimately SHARED across HD/SD/
    // backup variants — it can't be the channel id alone (duplicate React
    // keys, unselectable variants, favorites marking both). First holder
    // keeps the plain id (stable for favorites); later ones get a counter
    // suffix, deterministic because playlist order is.
    const usedIds = new Map<string, number>();

    for (const e of entries) {
      const group = e.groupTitle?.trim() || M3U_UNGROUPED;
      if (isHidden(group)) continue;
      if (!seen.has(group)) {
        seen.add(group);
        folders.push({ id: folderId(p.id, group), name: group });
      }
      const base = channelId(p.id, e.tvgId || hashId(e.url));
      const dupes = usedIds.get(base) ?? 0;
      usedIds.set(base, dupes + 1);
      const id = dupes === 0 ? base : `${base}~${dupes}`;
      channels.push({
        id,
        name: e.name,
        quality: extractQuality(e.name),
        folderId: folderId(p.id, group),
        logo: validUrl(e.logo),
        archiveDays: 0,
        number: e.channelNumber,
        url: e.url,
      });
      if (e.tvgId) {
        const list = epgIdx.get(e.tvgId) ?? [];
        list.push(id);
        epgIdx.set(e.tvgId, list);
      }
    }

    // EPG is best-effort — only when the playlist declares one AND some
    // channel carries a tvg-id to match against. Reasons land on epgError
    // for Settings → Playlists.
    let programmes = new Map<string, Programme[]>();
    let epgError: string | undefined;
    const epgUrl = m3uEpgUrl(text);
    if (epgUrl && epgIdx.size > 0) {
      try {
        onStage?.(`Downloading the ${p.name} TV guide…`);
        await breathe();
        const xml = await httpGetText(epgUrl, undefined, 180);
        onStage?.(`Reading the ${p.name} TV guide…`);
        await breathe();
        programmes = parseXmltv(xml, epgIdx, now);
        if (programmes.size === 0)
          epgError = "the guide downloaded but matched none of the channels";
      } catch (err) {
        epgError = `guide download failed — ${msg(err)}`;
        console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
      }
    } else if (!epgUrl) {
      epgError = "the playlist declares no guide (no url-tvg header)";
    } else {
      epgError = "no channel carries a tvg-id to match the guide against";
    }

    return {
      group: { id: p.id, name: p.name, folders, ...(epgError ? { epgError } : {}) },
      channels,
      programmes,
    };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      programmes: new Map(),
    };
  }
}

/** Build a source from a Stalker/MAG portal: handshake + genres + the bulk
 * channel list (with the paginated per-genre fallback inside
 * data/stalker.ts), EPG via get_epg_info's keyed map — compact JSON, no
 * XMLTV document. Channels carry their opaque `cmd` on Channel.streamCmd;
 * playback exchanges it per-play (stream.ts#resolveStreamUrl). Adult drops
 * mirror Xtream: a genre falls to the portal's `censored` flag or the name
 * pattern, a channel to its own `censored` flag. */
async function buildStalkerSource(
  p: StalkerPlaylist,
  now: Date,
  onStage?: (label: string) => void,
): Promise<{
  group: LiveGroup;
  channels: Channel[];
  programmes: Map<string, Programme[]>;
}> {
  try {
    onStage?.(`Signing in to ${p.name}…`);
    const genres = await fetchStalkerGenres(p);

    const showAdult = loadShowAdult();
    const userHidden = new Set(p.hiddenCategories ?? []);
    const hidden = new Set<string>();
    for (const g of genres) {
      if (userHidden.has(g.id)) hidden.add(g.id);
      else if (!showAdult && (g.censored || nameLooksAdult(g.title)))
        hidden.add(g.id);
    }
    const folders = genres
      .filter((g) => !hidden.has(g.id))
      .map((g) => ({ id: folderId(p.id, g.id), name: g.title }));

    onStage?.(`Fetching ${p.name} channels…`);
    await breathe();
    const t = performance.now();
    const raw = await fetchStalkerChannels(
      p,
      genres.map((g) => g.id),
    );
    console.info(
      `[live] ${p.name}: ${genres.length} genres + ${raw.length} channels in ${Math.round(performance.now() - t)}ms`,
    );

    const channels: Channel[] = [];
    // Kept portal channel ids, for scoping the EPG map to visible channels.
    const kept = new Set<string>();
    for (const c of raw) {
      const genre = c.genreId ?? "";
      if (hidden.has(genre)) continue;
      if (!showAdult && c.censored) continue; // per-channel adult flag
      kept.add(c.id);
      channels.push({
        id: channelId(p.id, c.id),
        name: c.name,
        quality: extractQuality(c.name),
        folderId: folderId(p.id, genre),
        logo: validUrl(c.logo),
        archiveDays: 0, // Stalker archive is its own create_link variant — with timeshift, later
        number: c.number,
        streamCmd: c.cmd,
      });
    }

    // EPG is best-effort. The portal returns UNIX-second programmes keyed by
    // channel id; clamp to the same window parseXmltv keeps (−1h..+12h) —
    // `period`'s unit is portal-dependent, so the clamp is client-side.
    const programmes = new Map<string, Programme[]>();
    let epgError: string | undefined;
    try {
      onStage?.(`Downloading the ${p.name} TV guide…`);
      await breathe();
      const epg = await fetchStalkerEpg(p);
      const winStart = now.getTime() - 3600_000;
      const winEnd = now.getTime() + 12 * 3600_000;
      for (const [chId, rows] of epg) {
        if (!kept.has(chId)) continue;
        const list: Programme[] = [];
        for (const r of rows) {
          const start = new Date(r.start * 1000);
          const end = new Date(r.stop * 1000);
          if (end.getTime() <= winStart || start.getTime() >= winEnd) continue;
          list.push({
            title: r.title,
            ...(r.synopsis ? { synopsis: r.synopsis } : {}),
            start,
            end,
          });
        }
        if (list.length) {
          list.sort((a, b) => a.start.getTime() - b.start.getTime());
          programmes.set(channelId(p.id, chId), list);
        }
      }
      console.info(
        `[live] ${p.name}: EPG for ${programmes.size} channels`,
      );
      if (programmes.size === 0)
        epgError = "the portal returned no guide data (get_epg_info empty)";
    } catch (err) {
      epgError = `guide download failed — ${msg(err)}`;
      console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
    }

    return {
      group: { id: p.id, name: p.name, folders, ...(epgError ? { epgError } : {}) },
      channels,
      programmes,
    };
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
        number: channelNumber(s),
      };
    });
}

/** Provider channel number (Xtream `num`), coerced from the panel's
 * string-or-number field. Undefined when absent or not a positive integer. */
export function channelNumber(s: XtreamStream): number | undefined {
  const n = Math.floor(Number(s.num));
  return Number.isFinite(n) && n > 0 ? n : undefined;
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
  const raw = e instanceof Error ? e.message : String(e);
  // NEVER surface a full URL (Xtream creds live in the path, M3U creds in
  // the query — and reqwest's transport errors embed the whole URL). Keep
  // only the origin so the message still names the host that failed. This
  // string reaches console logs AND the on-screen group.error.
  return raw.replace(/https?:\/\/[^\s"')]+/gi, (m) => {
    try {
      return new URL(m).origin + "/…";
    } catch {
      return "https://…";
    }
  });
}
