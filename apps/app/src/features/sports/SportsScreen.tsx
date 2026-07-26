import { RowScroller } from "../stream/StreamScreen";
import { GameCard } from "./GameCard";
import { UpcomingCard } from "./UpcomingCard";
import { PLACEHOLDER_GAMES, PLACEHOLDER_UPCOMING } from "./placeholder";

/**
 * The Sports hub (plan 010): games as the objects, your channels hanging
 * off them.
 *
 * Two sections so far: what is on now, and what is on later. Finished
 * games come with the schedule source (phase 0 is still a gate), and the
 * day-by-day rows below Later Today are the same row with a different
 * slice, so there is nothing to learn from building them twice.
 *
 * The row reuses Stream's RowScroller so the scroll behaviour, the fade and
 * the drag-to-scroll are the same object language as everywhere else.
 */
export function SportsScreen() {
  const live = PLACEHOLDER_GAMES.filter((g) => g.state === "live");

  return (
    <div className="discover sports">
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

      <section className="media-row">
        <h3 className="media-row__title sports__title">Later Today</h3>
        <RowScroller>
          {PLACEHOLDER_UPCOMING.map((g) => (
            <UpcomingCard key={g.id} game={g} />
          ))}
        </RowScroller>
      </section>
    </div>
  );
}
