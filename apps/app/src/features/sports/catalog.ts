import { useMemo } from "react";
import { lookupLive } from "../live/source";
import { useLiveData } from "../live/useLiveData";
import { indexChannels } from "./matcher";
import type { Catalog, Tunable } from "./matcher";
import type { Channel, LiveData } from "../live/model";

/**
 * The full channel behind a match, looked up at PLAY time.
 *
 * The matcher works on Tunable, which is a name, a quality and an id and
 * deliberately nothing else: it is a pure function over strings and has no
 * business carrying stream credentials around. Playing needs the real
 * Channel, so the id goes back to the catalog here.
 *
 * At play time rather than at match time, and the plan says why: "playlists
 * change under us and a stale channel id plays the wrong thing". This is
 * the same cache the guide reads, so it is a lookup rather than a load, and
 * a null means the sources changed under the rail, which is exactly when
 * we should not play something.
 *
 * lookupLive, not peekLive, since v0.9.84. peekLive also goes null when the
 * cache is half an hour old, and nothing on this tab reloads it, so 30
 * minutes into a game every rail click, autoplay and failover did nothing.
 */
export function tunedChannel(id: string): Channel | null {
  const live = lookupLive();
  if (!live) return null;
  return (
    live.channels.find((c) => c.id === id) ??
    live.hidden?.find((c) => c.id === id) ??
    null
  );
}

/**
 * The user's channels, arranged for the matcher (plan 010 phase 2).
 *
 * The Sports hub sits inside the Live world and reads the same catalog the
 * guide does, through the same single-flighted loader, so arriving here
 * first costs one load rather than a second copy of one.
 *
 * VISIBLE channels come from `channels` and HIDDEN ones from `hidden`,
 * flagged so `matchGame` can prefer the former; see LiveData.hidden for why
 * that list exists at all.
 */
/**
 * The channel index, per guide.
 *
 * Keyed on the LiveData object itself, which is the thing the index is a
 * function of: the guide is replaced wholesale by a refresh, so a new
 * object is exactly when a rebuild is owed and a WeakMap lets the old one
 * be collected with it.
 */
const INDEXES = new WeakMap<LiveData, Catalog>();

/**
 * The last index built, and what it was built from, by CONTENT.
 *
 * A refresh hands over a new LiveData, and usually the same channels: the
 * background revalidation after a launch from disk does, a minute in.
 * Keyed on the object alone, that rebuilt the index for nothing, 224 to
 * 367ms on a catalog the size of Adam's (the performance audit), on the
 * Sports board and on multi-view's first open alike. Reading the channels
 * to compare them costs a fraction of that: 26,000 channels here, 430ms to
 * build, under 35ms to find it was the same list.
 */
let last: { sig: string; built: Catalog } | null = null;

/** Two FNV-1a hashes over every field the index reads, and the counts. */
function signature(live: LiveData): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const mix = (s: string | null | undefined) => {
    const t = s ?? "";
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x5bd1e995);
    }
    a = Math.imul(a ^ 0x1f, 0x01000193);
    b = Math.imul(b ^ 0x1f, 0x5bd1e995);
  };
  const each = (list: readonly Channel[]) => {
    for (const c of list) {
      mix(c.id);
      mix(c.name);
      mix(c.quality);
      mix(c.logo);
    }
  };
  each(live.channels);
  mix("hidden");
  each(live.hidden ?? []);
  return `${live.channels.length}:${live.hidden?.length ?? 0}:${a >>> 0}:${b >>> 0}`;
}

/** The index for this guide, rebuilt only when its channels changed. */
export function catalogFor(live: LiveData): Catalog {
  // Across MOUNTS, not just across renders. useMemo dies with the
  // component, and App unmounts this screen every time you flip to the
  // Guide, so a useMemo alone rebuilt the whole index on each visit:
  // measured at 50 to 86ms on a 20,548 channel catalog, for a pure
  // function of an object that had not changed. Weak so a replaced guide
  // takes its index with it.
  const seen = INDEXES.get(live);
  if (seen) return seen;
  const sig = signature(live);
  if (last?.sig === sig) {
    INDEXES.set(live, last.built);
    return last.built;
  }
  const built = buildCatalog(live);
  INDEXES.set(live, built);
  last = { sig, built };
  return built;
}

export function useCatalog(): Catalog | null {
  // Loaded when cold, followed after. See useLiveData, which is where this
  // tab's own copy of that logic went.
  const live = useLiveData();
  return useMemo(() => (live ? catalogFor(live) : null), [live]);
}

function buildCatalog(live: LiveData): Catalog {
  const tunables: Tunable[] = [
    ...live.channels.map((c) => ({
      id: c.id,
      name: c.name,
      quality: c.quality,
      logo: c.logo,
    })),
    ...(live.hidden ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      quality: c.quality,
      logo: c.logo,
      hidden: true,
    })),
  ];
  // Measured on a 20,548-channel catalog: 100ms to build, and then 4.7ms
  // to resolve a 42-game board against it. The same board without the
  // index takes 3.7 SECONDS, which is the whole reason this is memoised
  // on the LiveData object rather than rebuilt per render.
  const t0 = performance.now();
  const built = indexChannels(tunables);
  // The other half of Multi-view's first open (mvGames liveChannels), and
  // the Sports board's: said only when it cost something.
  const ms = performance.now() - t0;
  if (ms > 50) console.info(`[sports] channel index: ${tunables.length} channels in ${Math.round(ms)}ms`);
  return built;
}
