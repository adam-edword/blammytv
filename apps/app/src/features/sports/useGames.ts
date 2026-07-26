import { useEffect, useState } from "react";
import { fetchGames } from "./espn";
import type { Game } from "./model";

/** How often a mounted hub re-reads TODAY. Later days do not move. */
const REFRESH_MS = 90_000;

/** Today plus this many days after it. */
const DAYS = 3;

export interface Day {
  /** Local midnight of the day this covers. */
  date: Date;
  /** Its games, in kick-off order. */
  games: Game[];
}

/**
 * The next few days of games, with today kept current.
 *
 * Today refreshes on a timer because scores move; the days after it are
 * fetched once, because a fixture list does not change while you are
 * looking at it and re-reading five leagues every 90 seconds to learn that
 * would be several hundred KB an hour for nothing.
 *
 * The timer only runs while the window is being looked at, and a failed
 * refresh keeps the last good board: a network blip should leave the
 * scores on screen for another 90 seconds, not blank the page.
 */
export function useGames(dayCount = DAYS) {
  const [days, setDays] = useState<Day[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const ac = new AbortController();
    let timer: number | undefined;

    const dates = Array.from({ length: dayCount }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      return d;
    });

    const loadAll = async () => {
      try {
        const all = await Promise.all(
          dates.map((date) => fetchGames({ date, signal: ac.signal })),
        );
        if (ac.signal.aborted) return;
        setDays(dates.map((date, i) => ({ date, games: onDay(all[i], date, i === 0) })));
        setState("ready");
      } catch {
        if (ac.signal.aborted) return;
        // Only the first load has nothing to fall back on.
        setState((s) => (s === "ready" ? "ready" : "error"));
      }
    };

    const loadToday = async () => {
      try {
        const games = await fetchGames({ date: dates[0], signal: ac.signal });
        if (ac.signal.aborted) return;
        setDays((prev) =>
          prev.length === 0
            ? prev
            : [{ date: dates[0], games: onDay(games, dates[0], true) }, ...prev.slice(1)],
        );
      } catch {
        // Keep what is on screen. The next tick will try again.
      }
    };

    const tick = () => {
      if (!document.hidden) void loadToday();
      timer = window.setTimeout(tick, REFRESH_MS);
    };

    void loadAll();
    timer = window.setTimeout(tick, REFRESH_MS);

    // Coming back to the app after a while: the board on screen is stale by
    // however long it was away, so read it again rather than waiting out
    // the rest of the interval.
    const onVisible = () => {
      if (!document.hidden) void loadToday();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      ac.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [dayCount]);

  return { days, state };
}

/**
 * The games that actually belong to a day, in kick-off order.
 *
 * Asking for a date is not the same as being given it. A league between
 * matchdays answers with its NEXT one whatever you asked for, which is how
 * a Premier League fixture 26 days out turned up under "Today".
 *
 * `keepLive` is for today only: a game that started at 11pm yesterday and
 * is still going is on now, whatever the date on it says.
 */
function onDay(games: Game[], date: Date, keepLive: boolean): Game[] {
  const key = date.toDateString();
  return games
    .filter(
      (g) =>
        g.start.toDateString() === key || (keepLive && g.state === "live"),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
