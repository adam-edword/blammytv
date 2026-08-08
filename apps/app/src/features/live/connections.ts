import { useEffect, useRef, useState } from "react";
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
/**
 * A second look after a tune CHANGE, because 4s is enough for a panel to
 * register a new session but not always enough for it to notice one has
 * gone. Without this the number sat wrong for up to a full POLL_MS after
 * stopping — which made "did the connection release?" untestable: the badge
 * read 1/3 twenty seconds after stopping whatever mpv had actually done.
 */
const SETTLE_MS = 20_000;

export function useConnections(
  tuneKey: string | null,
): Map<string, XtreamConnections> {
  const [conns, setConns] = useState<Map<string, XtreamConnections>>(
    () => new Map(),
  );
  /** First run of the effect vs a later tune change. Both arrive with
   * tuneKey null when nothing is playing — mount and "just stopped" are
   * indistinguishable from the key alone — and they want opposite timing:
   * mount should ask at once, a stop should give the panel a beat first. */
  const lastKey = useRef<string | null | undefined>(undefined);
  /** Monotonic token so only the NEWEST refresh may write. The 4s and 20s
   * looks are 16s apart while the Rust HTTP client's timeout is 30s, so the
   * early response can genuinely land after the late one and put the stale
   * count back. `stale` only guards across effect runs, not within one. */
  const seq = useRef(0);
  useEffect(() => {
    let stale = false;
    const refresh = () => {
      const mine = ++seq.current;
      for (const p of loadPlaylists()) {
        if (p.kind !== "xtream" || !p.enabled) continue;
        void fetchConnections(p).then((c) => {
          if (stale || mine !== seq.current) return;
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
    // First mount: ask at once, there is nothing to wait for. Any later
    // change — a tune STARTING or STOPPING — gives the panel a beat, then
    // looks again once it has had time to settle. Stopping used to refresh
    // at 0ms, which asked at the one moment the answer was guaranteed stale
    // and then held that stale number for a whole POLL_MS.
    // "The key CHANGED", not "the effect has run before" — StrictMode
    // double-invokes effects in dev, and a `mounted` boolean let the second
    // identical run consume the mount branch, pushing the first read from
    // 0ms to 4s in every dev build. tuneKey can legitimately be null, so the
    // sentinel is undefined.
    const first = lastKey.current === undefined || lastKey.current === tuneKey;
    lastKey.current = tuneKey;
    const delays = first ? [0] : [POST_TUNE_DELAY_MS, SETTLE_MS];
    const timers = delays.map((d) => window.setTimeout(refresh, d));
    const id = window.setInterval(refresh, POLL_MS);
    return () => {
      stale = true;
      timers.forEach(window.clearTimeout);
      window.clearInterval(id);
    };
  }, [tuneKey]);
  return conns;
}
