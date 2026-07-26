import { RowScroller } from "../stream/StreamScreen";
import { GameCard } from "./GameCard";
import { UpcomingCard } from "./UpcomingCard";
import { useGames } from "./useGames";

/**
 * The Sports hub (plan 010): games as the objects, your channels hanging
 * off them.
 *
 * Two sections so far: what is on now, and what is on later. Finished games
 * arrive from the source too and are not drawn yet; they want their own row
 * and their own card state, which is a design still in progress. The
 * day-by-day rows below Later Today are the same row with a different
 * slice, so there is nothing to learn from building them twice.
 *
 * The row reuses Stream's RowScroller so the scroll behaviour, the fade and
 * the drag-to-scroll are the same object language as everywhere else.
 */
export function SportsScreen() {
  const { games, state } = useGames();

  const live = games.filter((g) => g.state === "live");
  const upcoming = games
    .filter((g) => g.state === "pre")
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div className="discover sports">
      {/* A "Live Games" heading over an empty row reads as broken, so each
       * section only exists once it has something in it. */}
      {live.length > 0 && (
        <section className="media-row">
          <h3 className="media-row__title sports__title">
            <span className="sports__live-dot" aria-hidden />
            Live Games
          </h3>
          <RowScroller>
            {live.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </RowScroller>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="media-row">
          <h3 className="media-row__title sports__title">Later Today</h3>
          <RowScroller>
            {upcoming.map((g) => (
              <UpcomingCard key={g.id} game={g} />
            ))}
          </RowScroller>
        </section>
      )}

      {games.length === 0 && (
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
