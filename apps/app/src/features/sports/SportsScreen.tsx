import { useEffect, useMemo, useRef, useState } from "react";
import { RowScroller } from "../stream/StreamScreen";
import {
  loadCompactResults,
  saveCompactResults,
} from "../settings/compactResults";
import { CompactCard } from "./CompactCard";
import { RaceCard } from "./RaceCard";
import { WeekendCard } from "./WeekendCard";
import { SportsSidebar } from "./SportsSidebar";
import { useRaces } from "./race";
import { isFollowed, loadFollows } from "./follows";
import { GameCard } from "./GameCard";
import { dayLabel, nowish } from "./day";
import { SportsTheater } from "./SportsTheater";
import { UpcomingCard } from "./UpcomingCard";
import { useCatalog } from "./catalog";
import { useGames, withChannels } from "./useGames";
import type { Day } from "./useGames";
import type { Game } from "./model";

/**
 * The Sports hub (plan 010): games as the objects, your channels hanging
 * off them.
 *
 * Two ways of looking at the same day, on purpose:
 *
 *   the ROW    today as a timeline, in kick-off order, the way a guide
 *              reads. Wide cards, opened on whatever is on now. This is
 *              for "what should I watch".
 *   the GRIDS  a day at a time, all of it visible at once, small cards.
 *              This is for "what is on", and it is the only shape that
 *              works for days that have not happened yet.
 *
 * Today appears in both. That is not duplication: the row answers a
 * question about now and the grid answers one about the day.
 *
 * Opening a game replaces the board with the theater. Two modes and no
 * third: a small player on the board would either compete with the board
 * or be too small to be worth the room, and the board is already where you
 * go to stop watching.
 */

/**
 * How far in from the row's left edge the anchor game sits, when the
 * stylesheet has not been read yet. The real value is --sports-lead, which
 * also sizes the scroller's trailing padding; taking it from there is what
 * keeps the two ends of that arrangement agreeing.
 *
 * Not zero: the previous game peeks past it, which is what says the day
 * carries on behind you rather than starting here.
 */
const LEAD_FALLBACK = 96;

export function SportsScreen({ home }: { home?: number } = {}) {
  const { days: raw, state } = useGames();
  // The schedule and the channel list arrive independently, so they are
  // joined here rather than inside either one. Memoised on both: resolving
  // a 42-game board costs 4.7ms against a 20k-channel index and 3.7 SECONDS
  // without one, so it must not happen per render.
  const catalog = useCatalog();
  /**
   * What you follow, and therefore what the board shows.
   *
   * FOLLOWING IS FILTERING, in the plan's own words. Nothing followed means
   * nothing is narrowed: an empty store shows the whole board, so first run
   * is a full screen rather than an empty one asking to be configured.
   *
   * Applied AFTER withChannels rather than before, which costs a little
   * matcher work on games that are about to be dropped and buys the club
   * list its full set — the sidebar offers every club the board loaded, not
   * only the ones already surviving the filter it is trying to change.
   */
  const [follows, setFollows] = useState(loadFollows);
  const narrowed = follows.leagues.length > 0 || follows.teams.length > 0;
  const days = useMemo(() => {
    const withChans = raw.map((d) => ({
      ...d,
      games: withChannels(d.games, catalog),
    }));
    if (!narrowed) return withChans;
    return withChans.map((d) => ({
      ...d,
      games: d.games.filter((g) => isFollowed(g, follows)),
    }));
  }, [raw, catalog, follows, narrowed]);
  /** Every club the board LOADED, ahead of the filter. */
  const clubPool = useMemo(() => raw.flatMap((d) => d.games), [raw]);
  /* TEMPORARY: F1's cards at the head of today's grid, so they can be
   * looked at in the app while the racing adapter is written. It fetches
   * on its own and joins nothing; see race.ts.
   *
   * A weekend is ONE card until the day its first session runs, and its
   * five sessions from then on. */
  const { weekends, sessions: races } = useRaces();
  const racing = weekends.length + races.length;
  const today = days[0]?.games ?? [];
  const anchor = nowish(today);
  const live = today.some((g) => g.state === "live");

  const row = useRef<HTMLDivElement>(null);
  // The id we last scrolled to, NOT a "did it once" flag: the board
  // refreshes every 90 seconds, and re-centring on each of those would
  // shove the row out from under anyone reading it. It moves when the
  // anchor genuinely changes, which is when a game starts or ends.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor || centred.current === anchor.id) return;
    const card = row.current?.querySelector<HTMLElement>(
      `[data-game="${anchor.id}"]`,
    );
    const box = card?.closest<HTMLElement>(".media-row__scroller");
    if (!card || !box) return;
    centred.current = anchor.id;
    // Measured off rectangles rather than offsetLeft, which is relative to
    // whichever ancestor happens to be positioned. Instantly, not
    // smoothly: this is where the row starts, not somewhere it travels to.
    const lead =
      Number.parseFloat(
        getComputedStyle(box).getPropertyValue("--sports-lead"),
      ) || LEAD_FALLBACK;
    const c = card.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollLeft += c.left - b.left - lead;
  }, [anchor]);

  // The `|| races` half is TEMPORARY, with the grid gate below: a board
  // showing race cards is not a board with nothing on it, and saying so
  // under them would read as a bug.
  const anything = days.some((d) => d.games.length > 0) || racing > 0;
  // Read once and kept here: it is a display choice about this screen, so
  // it belongs to the screen rather than to every card in it.
  const [compact, setCompact] = useState(loadCompactResults);
  // The game being watched, or nothing. Deliberately NOT in the view stack:
  // this is a mode of one screen, and its own Escape and mouse-back close
  // it without touching where you came from to get here.
  const [open, setOpen] = useState<Game | null>(null);
  /**
   * Pressing the Sports chip returns to the board.
   *
   * It is the only thing on screen that looks like a way out of the
   * theater, and while the theater was open it did nothing at all: the tab
   * was already "sports", so setting it again changed no state. The header
   * counts the press instead, and this closes on the count changing. Skips
   * the first run, which is the mount.
   */
  const pressed = useRef(home);
  useEffect(() => {
    if (pressed.current === home) return;
    pressed.current = home;
    setOpen(null);
  }, [home]);
  const toggleCompact = () => {
    setCompact((on) => {
      saveCompactResults(!on);
      return !on;
    });
  };

  if (open) {
    // Re-read from the refreshed board so the theater follows the game's
    // STATE, not its score: the header carries two badges and two names and
    // no numbers at all. Fall back to the game as opened if it drops off
    // the day (it will not, but the board is a network read).
    const current = today.find((g) => g.id === open.id) ?? open;
    return (
      <SportsTheater
        game={current}
        others={today.filter((g) => g.state === "live" && g.id !== current.id)}
        catalog={catalog}
        onOpen={setOpen}
        onClose={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="sportsboard">
      <SportsSidebar
        games={clubPool}
        follows={follows}
        onFollows={setFollows}
      />
      <div className="discover sports sportsboard__main">
      {today.length > 0 && (
        <section className="media-row" ref={row}>
          <h3 className="media-row__title sports__title">
            {/* The pip is a claim about the world, so it only appears when
              * something is actually on. */}
            {live && <span className="gamepip" aria-hidden />}
            Today&rsquo;s Games
          </h3>
          <RowScroller>
            {today.map((g) => (
              <GameCard key={g.id} game={g} onOpen={setOpen} />
            ))}
          </RowScroller>
        </section>
      )}

      {days.map(
        (day) =>
          // TEMPORARY, the `|| races` half: the race cards hang off today's
          // grid, so a today with no TEAM games took the whole section down
          // and the races with it — which is exactly what you get the
          // moment a league is followed and today's fixtures fall outside
          // it. Goes away when racing is a real adapter and its sessions
          // are just games in the day.
          (day.games.length > 0 ||
            (day === days[0] && racing > 0)) && (
            <section className="media-row" key={day.date.toDateString()}>
              <div className="sports__head">
                <h3 className="media-row__title sports__title">
                  {dayLabel(day.date)}
                </h3>
                {/* Only where it would do something. A day with nothing
                  * finished on it has no results to compact. */}
                {day.games.some((g) => g.state === "final") && (
                  <button
                    type="button"
                    className={
                      "sports__toggle" + (compact ? " is-on" : "")
                    }
                    onClick={toggleCompact}
                    aria-pressed={compact}
                  >
                    Compact results
                  </button>
                )}
              </div>
              <div className="sports__grid">
                {/* TEMPORARY, today only: see race.ts. */}
                {day === days[0] &&
                  weekends.map((w) => (
                    <WeekendCard key={w.id} weekend={w} />
                  ))}
                {day === days[0] &&
                  races.map((r) => <RaceCard key={r.id} race={r} />)}
                {day.games.map((g) =>
                  compact && g.state === "final" ? (
                    <CompactCard key={g.id} game={g} onOpen={setOpen} />
                  ) : (
                    <UpcomingCard key={g.id} game={g} onOpen={setOpen} />
                  ),
                )}
              </div>
            </section>
          ),
      )}

      {!anything && (
        <p
          className="sports__note"
          // Swaps between loading, failed and empty with no announcement,
          // so after first paint none of it reached a screen reader.
          // DiscoverScreen already splits it exactly this way.
          role={state === "error" ? "alert" : "status"}
        >
          {state === "loading"
            ? "Loading today's games…"
            : state === "error"
              ? "Couldn't reach the schedule. Trying again shortly."
              : narrowed
                ? "Nothing on for what you follow. Widen it in the sidebar."
                : "Nothing on today."}
        </p>
      )}
      </div>
    </div>
  );
}

export type { Day };
