import { RowScroller } from "../stream/StreamScreen";
import { GameCard } from "./GameCard";
import { PLACEHOLDER_GAMES } from "./placeholder";

/**
 * The Sports hub (plan 010): games as the objects, your channels hanging
 * off them.
 *
 * Deliberately one section for now. The plan's shape is Live, then Up Next
 * Today, then Finished, but there is no schedule source yet (phase 0 is a
 * gate), so this is the frame and one real row rather than three rows of
 * invention.
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
    </div>
  );
}
