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

export function useCatalog(): Catalog | null {
  // Loaded when cold, followed after. See useLiveData, which is where this
  // tab's own copy of that logic went.
  const live = useLiveData();

  return useMemo(() => {
    if (!live) return null;
    // Across MOUNTS, not just across renders. useMemo dies with the
    // component, and App unmounts this screen every time you flip to the
    // Guide, so a useMemo alone rebuilt the whole index on each visit:
    // measured at 50 to 86ms on a 20,548 channel catalog, for a pure
    // function of an object that had not changed. Weak so a replaced guide
    // takes its index with it.
    const seen = INDEXES.get(live);
    if (seen) return seen;
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
    const built = indexChannels(tunables);
    INDEXES.set(live, built);
    return built;
  }, [live]);
}
