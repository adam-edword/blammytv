import { scrubbedMessage } from "../../lib/errors";
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
  onPlaylistsChange,
  type M3uPlaylist,
  type StalkerPlaylist,
  type XtreamPlaylist,
} from "../settings/playlists";
import { loadShowAdult } from "../settings/adultFilter";
import { httpGetBytes, httpGetText } from "../../lib/http";
import { isAdultCategory, isAdultStream, nameLooksAdult } from "./adult";
import { diskGet, diskPut } from "./diskCache";
import { normalizeProgrammes } from "./epg";
import { parseM3U } from "./m3u";
import type { Channel, LiveData, LiveGroup, Programme } from "./model";
import { extractQuality } from "./quality";
import type { XmltvStats } from "./xmltv";
import { parseXmltvOffThread } from "./xmltvThread";

/**
 * The seam between the Live tab and where its data comes from. With no
 * enabled playlists the result is empty (the tab hides itself in that
 * state). Real sources follow the old build's proven
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
  /** Started by a playlist change (force), which another forced call for
   * the same key joins. See loadLive. */
  forced: boolean;
} | null = null;

/** How old a DISK snapshot may be and still hydrate the guide instantly,
 * and how much schedule it keeps so that stays true. See epgWindow.ts: the
 * two are a pair, and were previously not (an 8h cache carrying 12h of
 * listings happened to work; a 40h one carrying 12h would not). */
import { DISK_MAX_AGE_MS, EPG_KEEP_AHEAD_MS } from "./epgWindow";

/** Fired after a BACKGROUND refresh lands fresh data in the memory cache —
 * the Live screen re-reads it silently (same path as playlist edits). */
const REFRESHED_EVENT = "blammytv:live-refreshed";
export function onLiveRefreshed(cb: () => void): () => void {
  window.addEventListener(REFRESHED_EVENT, cb);
  return () => window.removeEventListener(REFRESHED_EVENT, cb);
}
/** The webview always has a window; vitest's node environment does not, and
 * this fires from a detached promise where a throw would surface as an
 * unhandled rejection rather than a test failure. */
function announceRefresh() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(REFRESHED_EVENT));
}

/** Persist off the critical path: a structured-clone write of a ~15MB graph
 * costs real main-thread time, so let the first paint settle first. Only
 * doLoad's finished guide comes here, and every list in it was normalized
 * (or kept from a cache that was), so the record says so.
 *
 * The timer asks whether `key` is still the user's config before it writes.
 * The record's key holds an Xtream server, username and password, and
 * Clear All Login Info lands in this 1.5s window as readily as anywhere:
 * the clear emptied the disk, then this put the credentials straight back. */
function scheduleDiskPut(key: string, at: number, data: LiveData) {
  setTimeout(() => {
    if (!isCurrent(key)) return;
    void diskPut({ key, at, data, normalized: true });
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
  const record = { key, promise, stages, forced: false };
  inflight = record;
  promise
    .then((data) => {
      if (data.channels.length > 0) announceRefresh();
    })
    .catch(() => {})
    .finally(() => {
      if (inflight === record) inflight = null;
    });
}

/** The GUIDE half of a source build, resolved separately from the channel
 * half. A big provider's xmltv is ~100MB and takes a MINUTE to arrive, while
 * the catalog behind it is ready in seconds — so the builders hand this back
 * as a promise instead of awaiting it, doLoad returns the channels
 * immediately, and the programmes are merged in when they land (same
 * announce-and-re-read path the disk hydrate already uses). */
type EpgPhase = { programmes: Map<string, Programme[]>; epgError?: string };
type SourceBuild = {
  group: LiveGroup;
  channels: Channel[];
  /** Every builder fills this since v0.9.126; see LiveData.hidden. */
  hidden?: Channel[];
  epg: Promise<EpgPhase>;
};

/** Enabled sources: all three kinds load through the same pipeline. */
type LoadableSource = XtreamPlaylist | M3uPlaylist | StalkerPlaylist;
const enabledSources = (): LoadableSource[] =>
  loadPlaylists().filter((p) => p.enabled);

// hiddenCategories stays the LAST element of each source's entry: sameFeed
// drops it to ask whether two keys are one account.
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

/**
 * The cached catalog for the CURRENT sources, however old. For looking a
 * channel up by id at play time: Sports' rail, a game's autoplay and
 * failover, multi-view. And for anything else that only reads it: the
 * palette's channel search went empty half an hour in, off the Live tab.
 *
 * peekLive's half-hour TTL exists to make the Live screen refetch, and
 * nothing on the Sports tab ever reloads the catalog. So with peekLive
 * there, every tune silently did nothing 30 minutes after the catalog
 * loaded, which is the middle of the first half (v0.9.84). Age doesn't make
 * a channel id wrong; a changed config does, and the key still checks that.
 */
export function lookupLive(): LiveData | null {
  const key = cacheKey(enabledSources());
  return cache && cache.key === key ? cache.data : null;
}

/** Is `key` still the config the user has? A load started for an older one
 * must not write over the newer one's cache or its disk record. */
const isCurrent = (key: string) => cacheKey(enabledSources()) === key;

/** What a load started from: the memory cache, or the disk record a launch
 * hydrated into it. Its per-source config is read back out of its key. */
type Prior = { data: LiveData; parts: KeyParts | null };
type KeyParts = { entries: Map<string, unknown[]>; adult: unknown };

function keyParts(key: string): KeyParts | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) return null;
    const entries = new Map<string, unknown[]>();
    for (const e of parsed[0])
      if (Array.isArray(e) && typeof e[0] === "string") entries.set(e[0], e);
    return { entries, adult: parsed[1] };
  } catch {
    return null; // "mock", or a key from some other shape
  }
}

/** Was this source built from exactly the config it has now: its own entry
 * (id, credentials or URL, hidden folders) and the adult filter? Only then
 * is what it held last time still what it would hold. */
function sameBuild(prior: Prior, now: KeyParts | null, id: string): boolean {
  const was = prior.parts?.entries.get(id);
  const is = now?.entries.get(id);
  return (
    !!was &&
    !!is &&
    JSON.stringify(was) === JSON.stringify(is) &&
    JSON.stringify(prior.parts?.adult) === JSON.stringify(now?.adult)
  );
}

/** Is it the same account, whatever it hides? Programmes don't depend on
 * hidden folders or the adult filter, so those may differ. Credentials, the
 * server, the portal, the URL may not: the same channel id on another feed is
 * another channel. */
function sameFeed(prior: Prior, now: KeyParts | null, id: string): boolean {
  const was = prior.parts?.entries.get(id);
  const is = now?.entries.get(id);
  return (
    !!was &&
    !!is &&
    JSON.stringify(was.slice(0, -1)) === JSON.stringify(is.slice(0, -1))
  );
}

/** A source that failed to build keeps what it held at its last good load:
 * its channels, folders and hidden channels, when it was built from this
 * same config. The group still carries its `error`, so every place that says
 * "couldn't load this playlist" still says it. A changed config, or a source
 * that never loaded, gets nothing, as before. doLoad's guide phase reads
 * these channels off the build, so their programmes ride the `had`
 * carry-over like any other source's. */
function keepIfFailed(
  b: SourceBuild,
  p: LoadableSource,
  prior: Prior | null,
  now: KeyParts | null,
): SourceBuild {
  if (!b.group.error || !prior || !sameBuild(prior, now, p.id)) return b;
  const before = prior.data.groups.find((g) => g.id === p.id);
  if (!before) return b;
  const mine = (c: Channel) => c.id.startsWith(`${p.id}:`);
  const channels = prior.data.channels.filter(mine);
  const hidden = prior.data.hidden?.filter(mine);
  if (channels.length === 0 && !hidden?.length) return b;
  console.warn(
    `[live] ${p.name}: failed, keeping its ${channels.length} channels from the last good load`,
  );
  return {
    ...b,
    group: { ...b.group, folders: before.folders },
    channels,
    hidden,
  };
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
    // Stale, so reload, but KEEP it until the reload replaces it. This
    // used to null the cache first, and two things read it while a reload
    // runs: lookupLive, so Sports tuned nothing for the length of the
    // download, and doLoad's downgrade guard, which saw no guide and
    // published a guideless snapshot over one that was already here.
    // peekLive still reports it stale, so screens reload exactly as before.
  }

  // Join a matching load already in the air instead of doubling it. Forced
  // refreshes (playlist edits) start fresh — they exist to bypass stale work.
  // Except another FORCED one for this very key: that is one settled change
  // reaching us twice (the Guide's own listener and the app's, watchPlaylists),
  // and the second has no stale work to bypass that the first didn't.
  if (inflight && inflight.key === key && (!force || inflight.forced)) {
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
    forced: force,
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
        // Snapshots written before the normalize step existed still carry
        // overlapping programmes. A record that says it was normalized
        // skips it: 15 to 30ms on the launch path at 1,588 guides
        // (the Live auditor's shape, plan 016 5.6).
        if (!disk.normalized)
          for (const [id, list] of disk.data.programmes)
            disk.data.programmes.set(id, normalizeProgrammes(list));
        // A snapshot old enough to have run out of schedule renders as a
        // screen of "No Information" — the exact thing a cold load looks
        // like, with nothing to say a refresh is in flight. Say it. A guide
        // that still covers now stays quiet: the refresh behind it is
        // genuinely nothing the user needs to know about.
        if (!coversNow(disk.data, now)) disk.data.guidePending = true;
        // Stamped NOW, not with the snapshot's age. `at` is only the
        // in-memory TTL's clock, and a hydrate always has its revalidation
        // running behind it (below). Stamped with `disk.at`, a snapshot
        // more than half an hour old was stale the moment it landed:
        // peekLive said null to every screen that asked during the launch
        // download, so the Sports board opened empty and a remounted Guide
        // reloaded rather than showing the snapshot it already had.
        cache = { key, at: Date.now(), data: disk.data };
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

/** How long a burst of playlist saves has to be quiet before the catalog
 * reloads. Settings saves once per toggle. The Guide's own listener waits
 * the same time, so one change reaches loadLive twice at about the same
 * moment, which its single-flight turns into one load. */
export const PLAYLIST_SETTLE_MS = 800;

/**
 * Reload the catalog when the playlists change, whatever screen is up.
 *
 * Only the Guide listened, so a playlist added, toggled or edited in
 * Settings while Sports or Multi-view was showing (or the adult filter
 * flipped there) left lookupLive() null under the new key until the Guide
 * was opened: Sports' rail clicks, autoplay and failover did nothing, and
 * Multi-view kept the old catalog. App mounts this once.
 *
 * It announces when the channels land, not only when the guide does, so the
 * readers that follow onLiveRefreshed (Multi-view, Sports, Settings' status
 * rows) pick the new catalog up in seconds instead of after the xmltv. A
 * load that produced nothing announces nothing: there is nothing to re-read.
 */
export function watchPlaylists(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = onPlaylistsChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (enabledSources().length === 0) return;
      loadLive(new Date(), undefined, true)
        .then(() => {
          if (peekLive()) announceRefresh();
        })
        .catch(() => {});
    }, PLAYLIST_SETTLE_MS);
  });
  return () => {
    off();
    clearTimeout(timer);
  };
}

async function doLoad(
  playlists: LoadableSource[],
  key: string,
  now: Date,
  onStage: (label: string) => void,
): Promise<LiveData> {
  let data: LiveData;
  // What this load started from: the memory cache, or the disk record a
  // launch hydrated into it. Read now, before the builds run and anything
  // else lands in the cache. A failed source keeps its channels from it, and
  // every channel's programmes are seeded from it (below).
  const prior: Prior | null = cache
    ? { data: cache.data, parts: keyParts(cache.key) }
    : null;
  const current = keyParts(key);
  // Every source failed. Its channels may all be carried (keepIfFailed), but
  // it is still a total failure, and a total failure stays uncached (below).
  let allFailed = false;
  if (playlists.length === 0) {
    // Unreachable in normal use — the Live tab hides without an enabled
    // source — but load() is also called by refresh paths, so keep the
    // empty shape rather than throwing.
    data = { groups: [], channels: [], programmes: new Map() };
  } else {
    data = { groups: [], channels: [], programmes: new Map() };
    // Stage narration is a single last-writer-wins label, so it only makes
    // sense for one source. With several enabled, they load concurrently and
    // would stomp each other's labels (showing a finished source while a
    // different one is the one actually wedged) — fall back to the generic
    // "Loading channels…" the caller shows when no stage is reported.
    const narrate = playlists.length === 1 ? onStage : undefined;
    const built = (
      await Promise.all(
        playlists.map((p) =>
          p.kind === "m3u"
            ? buildM3uSource(p, now, narrate)
            : p.kind === "stalker"
              ? buildStalkerSource(p, now, narrate)
              : buildXtreamSource(p, now, narrate),
        ),
      )
    ).map((b, i) => keepIfFailed(b, playlists[i], prior, current));
    allFailed = built.every((b) => !!b.group.error);
    // Assembled in saved-playlist order, not arrival order. concat, not
    // push(...spread): spreading a six-figure channel list overflows the
    // argument stack. Programme lists are normalized here — the one choke
    // point all three builders share — so dirty provider EPGs (duplicate
    // entries with shifted starts, entries bleeding past their neighbour)
    // can't render overlapping guide cells.
    for (const src of built) {
      data.groups.push(src.group);
      data.channels = data.channels.concat(src.channels);
      if (src.hidden?.length)
        data.hidden = (data.hidden ?? []).concat(src.hidden);
    }
    // SEEDED from what this load started from. Hiding a folder, Undo and
    // the adult filter each change the cache key and force a reload, and the
    // reload's first phase had no programmes at all, so every lane read
    // "Loading guide…" for the whole xmltv download (60 to 77s on a big
    // guide). A programme doesn't depend on a hidden folder or the adult
    // filter, so every channel the new catalog holds, kept-aside ones
    // included (Undo brings those straight back), keeps the list it had,
    // provided its source is the same account. The same channel id on a
    // changed server or login is another channel and is not seeded. The guide
    // phase below still replaces all of it when the real guide lands.
    if (prior) {
      built.forEach((b, i) => {
        if (!sameFeed(prior, current, playlists[i].id)) return;
        for (const list of [b.channels, b.hidden ?? []])
          for (const c of list) {
            const kept = prior.data.programmes.get(c.id);
            if (kept) data.programmes.set(c.id, kept);
          }
      });
    }
    // The guide is still in the air. Channels render now (empty lanes read
    // as "No Information", which the guide already handles), and when the
    // programmes land we publish a NEW LiveData and announce it — the same
    // re-read the disk hydrate uses. A new object, not a mutation: the
    // screen holds this one in state and would never see an in-place edit.
    // `guidePending` still says the real guide is coming, whatever was seeded.
    data.guidePending = true;
    void Promise.all(built.map((b) => b.epg)).then((phases) => {
      const groups = built.map((b, i) =>
        phases[i].epgError
          ? { ...b.group, epgError: phases[i].epgError }
          : b.group,
      );
      // A source whose guide didn't come this time (a timeout, an error
      // page, a feed that matched nothing) keeps the one it had. A launch
      // hydrated from disk showed its guide, then a minute in every lane
      // went to "No Information" and the disk record lost its guide too.
      // The reason still lands on the group's epgError.
      const had = cache?.key === key ? cache.data.programmes : null;
      const programmes = new Map<string, Programme[]>();
      phases.forEach((phase, i) => {
        if (phase.programmes.size === 0 && had) {
          for (const c of built[i].channels) {
            const kept = had.get(c.id);
            if (kept) programmes.set(c.id, kept);
          }
          return;
        }
        for (const [id, list] of phase.programmes)
          programmes.set(id, normalizeProgrammes(list));
      });
      const full: LiveData = {
        groups,
        channels: data.channels,
        hidden: data.hidden,
        programmes,
      };
      if (full.channels.length === 0 || allFailed) return;
      // A guide for a config the user has since changed (hid a folder,
      // flipped the adult filter) lands late: it must not replace the
      // newer config's cache or overwrite the one disk record, and its
      // announce would only trigger a reload of the right one anyway.
      if (!isCurrent(key)) return;
      const at = Date.now();
      cache = { key, at, data: full };
      scheduleDiskPut(key, at, full);
      announceRefresh();
    }).catch((err) => {
      console.warn("[live] guide phase failed:", err);
    });
  }

  // A total failure (no channels at all) stays uncached so the next mount
  // retries instead of pinning the error for half an hour. So does one where
  // every source failed and their channels were carried from the last good
  // load: the screen shows them, and the next mount still tries again. Real
  // playlist loads also persist to disk for the next launch's instant hydrate.
  if (data.channels.length > 0 && !allFailed) {
    const at = Date.now();
    // MUST NOT DOWNGRADE A GUIDE THAT IS ALREADY HERE.
    //
    // This channel-half write exists for a COLD load, so the lanes appear
    // before the XMLTV lands. A disk-hydrated launch is the opposite case:
    // it publishes a complete guide instantly, then calls this in the
    // background, and this replaced it with an empty programme map for the
    // entire length of the download. Every lane flipped back to "Loading
    // guide…" a few seconds after the guide appeared, which is the exact
    // thing the disk cache exists to prevent.
    //
    // The two-phase split (v0.7.11) introduced the guideless intermediate
    // write; the background revalidation predates it and was never taught
    // about it. The guide phase above publishes the complete record.
    //
    // Seeding (above) can give `data` programmes of its own, so this no
    // longer asks whether it is guideless. It asks whether a guide is
    // already here under this key, and then leaves it alone: publishing over
    // it would put "Guide still downloading…" on a guide that is complete. A
    // different key has no guide to protect, and its seeded snapshot goes out.
    const holdsGuide = cache?.key === key && cache.data.programmes.size > 0;
    if (!holdsGuide && isCurrent(key)) cache = { key, at, data };
    // NO disk write here any more: this snapshot has no guide yet, and
    // persisting it would let the next launch hydrate a guideless catalog
    // and then sit through the whole download again. The guide phase above
    // writes the complete record once the programmes land.
  }
  return data;
}

/** Does this snapshot still have a schedule for right now?
 *
 * The disk window is wide (40h) because a stale guide beats a minute of
 * empty lanes, and xmltv files normally carry days. "Normally" is the catch:
 * a provider publishing only 24h of schedule leaves a 30h-old snapshot
 * technically loaded and practically empty. One programme covering `now`
 * anywhere in the catalog is enough to call it live — this answers "is
 * there a guide" and not "is every channel covered", which is a different
 * question with its own diagnostic. */
function coversNow(data: LiveData, now: Date): boolean {
  const t = now.getTime();
  for (const list of data.programmes.values())
    for (const p of list)
      if (p.start.getTime() <= t && p.end.getTime() > t) return true;
  return false;
}

/** Yield a macrotask so the loading UI can paint between blocking stages
 * (huge playlists spend whole seconds in single JSON.parse / DOMParser
 * calls that nothing can interrupt). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

async function buildXtreamSource(
  p: XtreamPlaylist,
  now: Date,
  onStage?: (label: string) => void,
): Promise<SourceBuild> {
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
    // What the hidden folders are holding, for the sports matcher's
    // fallback and nothing else. Same adult filter as above.
    const hiddenChannels = mapHiddenStreams(streams, p, cats, showAdult);

    // EPG is best-effort — channels still render "No Information" without
    // it. Whatever goes wrong lands on group.epgError so an installed user
    // can read the reason in Settings → Playlists (the console is invisible
    // in a packaged build).
    // NOT awaited: this is the minute-long half. The channel list below
    // returns without it and doLoad merges the programmes when they land.
    const epg = (async (): Promise<EpgPhase> => {
      try {
        const bytes = await xmlPromise; // in flight since right after sign-in
        const fetched = performance.now();
        // Read before the worker takes the bytes, which empties this view.
        const mb = (bytes.byteLength / 1e6).toFixed(1);
        const index = epgIndex(streams, p, hidden, !showAdult);
        const stats: XmltvStats = {
          guideChannels: 0,
          unmatchedOurs: [],
          unmatchedTheirs: [],
          recovered: 0,
        };
        // On a worker: 3.3 seconds of a frozen app on Adam's 106MB guide,
        // every refresh, when it ran here (xmltvThread.ts).
        const { programmes, onWorker } = await parseXmltvOffThread(bytes, index, now, stats);
        console.info(
          `[live] ${p.name}: xmltv ${mb}MB in ${Math.round(fetched - xmlT0)}ms (overlapped), parsed EPG for ${programmes.size} channels in ${Math.round(performance.now() - fetched)}ms (${onWorker ? "off the page's thread" : "on the page"})`,
        );
        // Coverage, because "248 guides for 1920 channels" has two very
        // different explanations. `channels with an epg id` vs `matched`
        // says whether the panel even claims a guide for them; the two
        // unmatched samples side by side reveal a case/format mismatch,
        // which would mean the data is in the download and we are
        // discarding it.
        console.info(
          `[live] ${p.name}: EPG coverage — ${channels.length} channels, ` +
            `${index.size} carry an epg id, guide declares ${stats.guideChannels}, ` +
            `${programmes.size} matched` +
            // Above zero and the answer is "matching bug", settled: that
            // many guide ids were in the download all along and only a
            // case or spacing difference was hiding them.
            (stats.recovered
              ? `, ${stats.recovered} recovered by normalising case/spacing`
              : ""),
          stats.unmatchedOurs.length || stats.unmatchedTheirs.length
            ? { ourIdsWithNoGuide: stats.unmatchedOurs, guideIdsWeNeverUsed: stats.unmatchedTheirs }
            : "(everything matched)",
        );
        if (index.size === 0)
          return {
            programmes,
            epgError: "the panel's channels carry no EPG ids to match a guide",
          };
        if (programmes.size === 0)
          return {
            programmes,
            epgError: `the guide downloaded (${mb}MB) but matched none of the channels`,
          };
        return { programmes };
      } catch (err) {
        console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
        return {
          programmes: new Map(),
          epgError: `guide download failed: ${msg(err)}`,
        };
      }
    })();

    return {
      group: { id: p.id, name: p.name, folders },
      channels,
      hidden: hiddenChannels,
      epg,
    };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      epg: Promise.resolve({ programmes: new Map() }),
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
): Promise<SourceBuild> {
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
    // What the folders the USER hid hold, kept aside as Xtream's are
    // (LiveData.hidden): multi-view's remembered tiles still find them, and
    // the sports matcher may fall back on them. Never what the adult filter
    // hid. Hiding one used to delete its channels' multi-view tiles (plan
    // 018, L5). Numbered apart, so keeping them doesn't change a visible
    // channel's id from what it was before they were kept. That can give
    // one the id of a visible channel sharing its tvg-id; it goes, below.
    const hiddenIds = new Map<string, number>();
    const hiddenChannels: Channel[] = [];

    for (const e of entries) {
      const group = e.groupTitle?.trim() || M3U_UNGROUPED;
      const aside = isHidden(group);
      if (aside && !(userHidden.has(group) && (showAdult || !nameLooksAdult(group)))) continue;
      if (!aside && !seen.has(group)) {
        seen.add(group);
        folders.push({ id: folderId(p.id, group), name: group });
      }
      // The URL goes to mpv, which treats a bare path as a FILE. An
      // unvalidated line lets a playlist host hand us a UNC path
      // (\\attacker\share\x.mkv), and Windows will authenticate to it and
      // leak the user's NTLM hash, or a file:// to read anything on disk.
      // The validator was already in this file and already applied to the
      // logo one line below; the url is the string that actually matters.
      // Dropped rather than kept unplayable: a channel we must refuse to
      // open is worse than a channel that is not there.
      const safe = validUrl(e.url);
      if (!safe) continue;
      const base = channelId(p.id, e.tvgId || hashId(e.url));
      const ids = aside ? hiddenIds : usedIds;
      const dupes = ids.get(base) ?? 0;
      ids.set(base, dupes + 1);
      const id = dupes === 0 ? base : `${base}~${dupes}`;
      const channel: Channel = {
        id,
        name: e.name,
        quality: extractQuality(e.name),
        folderId: folderId(p.id, group),
        logo: validUrl(e.logo),
        archiveDays: 0,
        number: e.channelNumber,
        url: safe,
      };
      if (aside) {
        hiddenChannels.push(channel);
        continue;
      }
      channels.push(channel);
      if (e.tvgId) {
        const list = epgIdx.get(e.tvgId) ?? [];
        list.push(id);
        epgIdx.set(e.tvgId, list);
      }
    }

    // EPG is best-effort — only when the playlist declares one AND some
    // channel carries a tvg-id to match against. Reasons land on epgError
    // for Settings → Playlists.
    const epgUrl = m3uEpgUrl(text);
    const epg = (async (): Promise<EpgPhase> => {
      const none = new Map<string, Programme[]>();
      if (!epgUrl)
        return {
          programmes: none,
          epgError: "the playlist declares no guide (no url-tvg header)",
        };
      if (epgIdx.size === 0)
        return {
          programmes: none,
          epgError: "no channel carries a tvg-id to match the guide against",
        };
      try {
        const bytes = await httpGetBytes(epgUrl, undefined, 180);
        // On a worker, as the Xtream guide is (xmltvThread.ts).
        const { programmes } = await parseXmltvOffThread(bytes, epgIdx, now);
        return programmes.size === 0
          ? {
              programmes,
              epgError: "the guide downloaded but matched none of the channels",
            }
          : { programmes };
      } catch (err) {
        console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
        return {
          programmes: none,
          epgError: `guide download failed: ${msg(err)}`,
        };
      }
    })();

    // A kept channel whose id a visible one already holds: a lookup finds
    // the visible one first anyway, and two channels with one id would be
    // two rows with one key on the Sports rail.
    const visibleIds = new Set(channels.map((c) => c.id));
    const hidden = hiddenChannels.filter((c) => !visibleIds.has(c.id));

    return { group: { id: p.id, name: p.name, folders }, channels, hidden, epg };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      epg: Promise.resolve({ programmes: new Map() }),
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
): Promise<SourceBuild> {
  try {
    onStage?.(`Signing in to ${p.name}…`);
    const genres = await fetchStalkerGenres(p);

    const showAdult = loadShowAdult();
    const userHidden = new Set(p.hiddenCategories ?? []);
    const hidden = new Set<string>();
    // The folders only the USER hid, whose channels are kept aside as an
    // Xtream line's are (LiveData.hidden; plan 018, L5). Not a genre the
    // adult filter would hide too.
    const aside = new Set<string>();
    for (const g of genres) {
      const adult = !showAdult && (g.censored || nameLooksAdult(g.title));
      if (userHidden.has(g.id)) {
        hidden.add(g.id);
        if (!adult) aside.add(g.id);
      } else if (adult) hidden.add(g.id);
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
    const hiddenChannels: Channel[] = [];
    // Kept portal channel ids, for scoping the EPG map to visible channels.
    const kept = new Set<string>();
    for (const c of raw) {
      const genre = c.genreId ?? "";
      if (!showAdult && c.censored) continue; // per-channel adult flag
      if (hidden.has(genre)) {
        if (aside.has(genre))
          hiddenChannels.push({
            id: channelId(p.id, c.id),
            name: c.name,
            quality: extractQuality(c.name),
            folderId: folderId(p.id, genre),
            logo: validUrl(c.logo),
            archiveDays: 0,
            number: c.number,
            streamCmd: c.cmd,
          });
        continue;
      }
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
    // channel id; clamp to the same window parseXmltv keeps —
    // `period`'s unit is portal-dependent, so the clamp is client-side.
    const epg = (async (): Promise<EpgPhase> => {
      const programmes = new Map<string, Programme[]>();
      try {
        const rowsById = await fetchStalkerEpg(p);
        const winStart = now.getTime() - 3600_000;
        const winEnd = now.getTime() + EPG_KEEP_AHEAD_MS;
        for (const [chId, rows] of rowsById) {
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
        console.info(`[live] ${p.name}: EPG for ${programmes.size} channels`);
        return programmes.size === 0
          ? {
              programmes,
              epgError:
                "the portal returned no guide data (get_epg_info empty)",
            }
          : { programmes };
      } catch (err) {
        console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
        return {
          programmes: new Map(),
          epgError: `guide download failed: ${msg(err)}`,
        };
      }
    })();

    return { group: { id: p.id, name: p.name, folders }, channels, hidden: hiddenChannels, epg };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      epg: Promise.resolve({ programmes: new Map() }),
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
    .map((s) => toChannel(s, p));
}

/**
 * The channels a hidden folder is hiding, for the Sports hub alone.
 *
 * The rule above stands for the guide: hiding a folder hides its content.
 * But a GAME is a different question from a channel list, and a Sunday
 * where the only copy of the game sits in a folder you muted is exactly
 * when the app should still be able to find it. So the sports matcher gets
 * to look here, after it has failed to find anything visible, and nothing
 * else reads this list (see LiveData.hidden).
 *
 * The adult filter is NOT a folder preference and is not relaxed here: it
 * stays applied exactly as it is above, so this cannot become a back door
 * to content the filter is holding back.
 */
export function mapHiddenStreams(
  streams: XtreamStream[],
  p: XtreamPlaylist,
  cats: XtreamCategory[] = [],
  showAdult = false,
): Channel[] {
  // Deliberately NOT droppedCategories. That set is two different things
  // added together: folders the USER hid, and categories the ADULT FILTER
  // hid. Only the first is a preference about clutter that a game may
  // reasonably look past; the second is the filter doing its job, and
  // searching it would turn the sports hub into a way around it. So this
  // starts from the user's own list and subtracts the adult ones back out.
  const userHidden = new Set(p.hiddenCategories ?? []);
  if (!showAdult)
    for (const c of cats) if (isAdultCategory(c)) userHidden.delete(c.id);
  if (userHidden.size === 0) return [];
  return streams
    .filter(
      (s) =>
        userHidden.has(String(s.category_id ?? "")) &&
        !(!showAdult && isAdultStream(s)),
    )
    .map((s) => toChannel(s, p));
}

function toChannel(s: XtreamStream, p: XtreamPlaylist): Channel {
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

// NEVER surface a full URL (Xtream creds live in the path, M3U creds in
// the query — and reqwest's transport errors embed the whole URL). The
// shared scrubber keeps only the origin; this string reaches console
// logs AND the on-screen group.error.
const msg = scrubbedMessage;
