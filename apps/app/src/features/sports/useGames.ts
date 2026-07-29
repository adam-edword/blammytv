import { useEffect, useState } from "react";
import { onDay } from "./day";
import { fetchGames } from "./espn";
import { CARD_CONFIDENCE, matchEvent, matchGame } from "./matcher";
import type { Catalog } from "./matcher";
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
            : [
                {
                  date: dates[0],
                  games: keepStable(prev[0].games, onDay(games, dates[0], true)),
                },
                ...prev.slice(1),
              ],
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
 * Carry the PREVIOUS object forward for every game that has not changed.
 *
 * A refresh builds all-new Game objects out of all-new JSON, so every card
 * gets a new prop and re-renders even on the overwhelmingly common tick
 * where nothing moved. Measured on the layout rig, one tick over a 168-card
 * board: 584 DOM mutations and an 86ms long task, and every single one of
 * those mutations was react-parallax-tilt rewriting its own inline
 * transform. No text, no score, nothing a viewer could see.
 *
 * Reference equality is what React.memo on the cards reads, so preserving
 * identity here is what makes that memo work. Deliberately exact: any
 * difference at all, down to a venue string, hands back the new object and
 * the card re-renders. This can only ever skip work that would have
 * produced an identical card.
 */
export function keepStable(prev: Game[], next: Game[]): Game[] {
  if (prev.length === 0) return next;
  const before = new Map(prev.map((g) => [g.id, g]));
  return next.map((game) => {
    const old = before.get(game.id);
    // Cheap and total: Date serialises to its instant, and every field the
    // cards read is JSON. An unstable key order cannot arise because both
    // objects are built by the same mapper.
    return old && JSON.stringify(old) === JSON.stringify(game) ? old : game;
  });
}

/**
 * Fill in each game's channels from the user's catalog.
 *
 * Kept OUT of the fetching hook on purpose: the schedule and the channel
 * list arrive on their own schedules, and folding them together would mean
 * re-reading ESPN every time the guide refreshed.
 *
 * Identity is preserved where the answer has not changed, for the same
 * reason keepStable exists: the cards are memoised on it, and a board whose
 * channels resolved identically must not re-render.
 */
export function withChannels(games: Game[], catalog: Catalog | null): Game[] {
  // Not "no channels": not KNOWN yet. The cards say so rather than
  // guessing, and identity is preserved so this costs no re-render once the
  // guide lands and the flag clears.
  if (!catalog)
    return games.map((g) =>
      g.channelsPending ? g : { ...g, channelsPending: true },
    );
  return games.map((game) => {
    // The CARD only counts what we are sure of. A 40% match is a candidate
    // for the rail, where its score is visible; putting it behind "Live on
    // 3 channels" would be the silent wrongness plan 010 warns about.
    // A channel that names THIS fixture beats any channel that merely
    // carries the network showing it, so it goes first and is never
    // displaced by a national feed's ordering.
    const named = matchEvent([game.home.name, game.away.name], game.start, catalog);
    const seen = new Set(named.map((c) => c.id));
    const found = [
      ...named,
      ...matchGame(game.broadcasts, catalog).filter((c) => !seen.has(c.id)),
    ].filter((c) => c.confidence >= CARD_CONFIDENCE);
    const channels = found.map((c) => ({ id: c.id, name: c.name }));
    const hiddenOnly = found.length > 0 && found.every((c) => c.hidden);
    const unchanged =
      channels.length === game.channels.length &&
      channels.every((c, i) => c.id === game.channels[i].id) &&
      hiddenOnly === (game.hiddenOnly ?? false) &&
      !game.channelsPending;
    return unchanged
      ? game
      : { ...game, channels, hiddenOnly, channelsPending: false };
  });
}
