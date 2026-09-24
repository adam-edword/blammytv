import { useEffect, useState } from "react";
import { loadLive, lookupLive, onLiveRefreshed, peekLive } from "./source";
import type { LiveData } from "./model";

/**
 * The live catalog for a screen that is not the Guide: Sports, Multi-view.
 *
 * Loads it when nothing has, and follows it after. Both halves matter.
 * Multi-view read `lookupLive()` once at mount and nothing more (v0.9.105),
 * so launching on Stream and going straight to Multi-view left its search
 * saying "Nothing matches that" for the whole visit: the Guide, which is
 * what normally loads the catalog, had never mounted. Sports had solved
 * the same problem inside useCatalog; this is that code, moved here so both
 * tabs share one copy.
 */
export function useLiveData(): LiveData | null {
  // lookupLive for the FIRST paint, so a catalog older than half an hour
  // still draws while the effect below reloads it.
  const [live, setLive] = useState<LiveData | null>(lookupLive);

  useEffect(() => {
    let alive = true;
    // Cold start, which only happens if this tab is the first thing opened.
    // loadLive is single-flighted and cached, so this joins the Live
    // screen's load rather than starting a second one.
    if (!peekLive()) {
      void loadLive(new Date()).then(() => {
        // Whatever is CURRENT, not what this call resolved with. A
        // playlist edit during a cold load starts a second, forced load
        // that finishes first; taking this one's result then regressed the
        // screen to the catalog the user had just changed. The refresh
        // listener below already reads it this way.
        const fresh = peekLive();
        if (alive && fresh) setLive(fresh);
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

  return live;
}
