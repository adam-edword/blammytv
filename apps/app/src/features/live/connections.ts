import { useEffect, useState } from "react";
import {
  fetchConnections,
  type XtreamConnections,
} from "../../data/xtream";
import { loadPlaylists } from "../settings/playlists";

/**
 * Per-source connection usage for the sidebar pills ("2/5"). Xtream only:
 * the panel's player_api reports active_cons/max_connections on the same
 * tiny endpoint authenticate rides; Stalker portals rarely expose limits
 * (skipped rather than shown wrong) and M3U has no API at all.
 *
 * Polls while the Live tab is mounted (the screen unmounts on tab switch,
 * so this dies with it) and re-polls shortly after each tune — panels
 * take a few seconds to register the new session, and the number Bobby
 * actually cares about includes his own stream.
 */
const POLL_MS = 60_000;
const POST_TUNE_DELAY_MS = 4_000;

export function useConnections(
  tuneKey: string | null,
): Map<string, XtreamConnections> {
  const [conns, setConns] = useState<Map<string, XtreamConnections>>(
    () => new Map(),
  );
  useEffect(() => {
    let stale = false;
    const refresh = () => {
      for (const p of loadPlaylists()) {
        if (p.kind !== "xtream" || !p.enabled) continue;
        void fetchConnections(p).then((c) => {
          if (stale) return;
          // Pure updater (StrictMode) that keeps the Map identity stable
          // when nothing changed — the sidebar re-renders on every tick
          // otherwise.
          setConns((prev) => {
            const cur = prev.get(p.id);
            const same = c
              ? cur?.active === c.active && cur?.max === c.max
              : !cur;
            if (same) return prev;
            const next = new Map(prev);
            if (c) next.set(p.id, c);
            else next.delete(p.id);
            return next;
          });
        });
      }
    };
    // Mount (tuneKey null-or-first): immediate. Tune change: give the
    // panel a beat to count the new session before asking.
    const t = window.setTimeout(refresh, tuneKey ? POST_TUNE_DELAY_MS : 0);
    const id = window.setInterval(refresh, POLL_MS);
    return () => {
      stale = true;
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [tuneKey]);
  return conns;
}
