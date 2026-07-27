import { useEffect, useRef, useState } from "react";
import { RowScroller } from "../stream/StreamScreen";
import {
  loadCompactResults,
  saveCompactResults,
} from "../settings/compactResults";
import { CompactCard } from "./CompactCard";
import { GameCard } from "./GameCard";
import { SportsTheater } from "./SportsTheater";
import { UpcomingCard } from "./UpcomingCard";
import { useGames } from "./useGames";
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

export function SportsScreen() {
  const { days, state } = useGames();
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

  const anything = days.some((d) => d.games.length > 0);
  // Read once and kept here: it is a display choice about this screen, so
  // it belongs to the screen rather than to every card in it.
  const [compact, setCompact] = useState(loadCompactResults);
  // The game being watched, or nothing. Deliberately NOT in the view stack:
  // this is a mode of one screen, and its own Escape and mouse-back close
  // it without touching where you came from to get here.
  const [open, setOpen] = useState<Game | null>(null);
  const toggleCompact = () => {
    setCompact((on) => {
      saveCompactResults(!on);
      return !on;
    });
  };

  if (open) {
    // Re-read from the refreshed board, so a score on the theater's own
    // header keeps moving; fall back to the game as opened if it drops off
    // the day (it will not, but the board is a network read).
    const current = today.find((g) => g.id === open.id) ?? open;
    return (
      <SportsTheater
        game={current}
        others={today.filter((g) => g.state === "live" && g.id !== current.id)}
        onClose={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="discover sports">
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
          day.games.length > 0 && (
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
        <p className="sports__note">
          {state === "loading"
            ? "Loading today's games…"
            : state === "error"
              ? "Couldn't reach the schedule. Trying again shortly."
              : "Nothing on today."}
        </p>
      )}
    </div>
  );
}

/**
 * What a day's grid is called. The first two get their names; after that a
 * weekday is not enough on its own, because "Wednesday" alone could be any
 * of them.
 */
function dayLabel(date: Date): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round(
    (date.getTime() - midnight.getTime()) / (24 * 3600_000),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * The game the row should open on: whatever is live, and failing that the
 * one that finished most recently, and failing that the next to start.
 *
 * In kick-off order already, so the last final is the latest one.
 */
function nowish(today: Game[]): Game | undefined {
  return (
    today.find((g) => g.state === "live") ??
    today.filter((g) => g.state === "final").at(-1) ??
    today.find((g) => g.state === "pre")
  );
}

export type { Day };
