import { useEffect, useMemo, useState } from "react";
import { loadLive, onLiveRefreshed, peekLive } from "../live/source";
import { indexChannels } from "./matcher";
import type { Catalog, Tunable } from "./matcher";
import type { LiveData } from "../live/model";

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
export function useCatalog(): Catalog | null {
  // peekLive is synchronous and usually warm, because the guide has almost
  // always loaded before anyone reaches this tab. Starting from it means the
  // board's first paint already carries channels rather than flashing "not
  // on your channels" and correcting itself a moment later.
  const [live, setLive] = useState<LiveData | null>(peekLive);

  useEffect(() => {
    let alive = true;
    // Cold start, which only happens if this tab is the first thing opened.
    // loadLive is single-flighted and cached, so this joins the Live
    // screen's load rather than starting a second one.
    if (!peekLive()) {
      void loadLive(new Date()).then((d) => {
        if (alive) setLive(d);
      });
    }
    // The guide lands in two phases and a background refresh replaces it, so
    // re-read on the same announcement the Live screen listens to.
    const off = onLiveRefreshed(() => {
      const fresh = peekLive();
      if (alive && fresh) setLive(fresh);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  return useMemo(() => {
    if (!live) return null;
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
    return indexChannels(tunables);
  }, [live]);
}
