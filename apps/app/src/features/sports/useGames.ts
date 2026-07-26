import { useEffect, useState } from "react";
import { fetchGames } from "./espn";
import type { Game } from "./model";

/** How often a mounted hub re-reads the board. */
const REFRESH_MS = 90_000;

/**
 * Today's games, kept current while the hub is open.
 *
 * Scores move, so a board fetched once and left alone is wrong within
 * minutes. It refreshes on a timer, but only while the window is actually
 * being looked at: the payload is a few hundred KB per league and there is
 * no reason to pull it for a hidden tab.
 *
 * Keeps the last good list through a failed refresh. A network blip should
 * leave yesterday's scores on screen for another 90 seconds, not blank the
 * page.
 */
export function useGames() {
  const [games, setGames] = useState<Game[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const ac = new AbortController();
    let timer: number | undefined;

    const load = async () => {
      try {
        const next = await fetchGames(ac.signal);
        if (ac.signal.aborted) return;
        setGames(next);
        setState("ready");
      } catch {
        if (ac.signal.aborted) return;
        // Only the first load has nothing to fall back on.
        setState((s) => (s === "ready" ? "ready" : "error"));
      }
    };

    const tick = () => {
      if (!document.hidden) void load();
      timer = window.setTimeout(tick, REFRESH_MS);
    };

    void load();
    timer = window.setTimeout(tick, REFRESH_MS);

    // Coming back to the app after a while: the board on screen is stale by
    // however long it was away, so read it again rather than waiting out
    // the rest of the interval.
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ac.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { games, state };
}
