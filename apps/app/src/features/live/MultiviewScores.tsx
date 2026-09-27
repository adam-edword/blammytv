import { Fragment, useEffect, useRef } from "react";
import { CompactCard } from "../sports/CompactCard";
import type { Fixture } from "../sports/model";
import { LeaguesIcon } from "../../ui/icons";
import { Hint } from "../../ui/Hint";
import { useDragScroll } from "../../lib/useDragScroll";

/**
 * Multi-view's Live Scores row (Adam, v0.10.6: "at the bottom in one
 * scrollable row ... with a filter"). The Sports theater's score tracker,
 * its compact team-coloured cards, laid out as one line under the grid
 * instead of a column beside it, so the grid gives up height and keeps its
 * width.
 *
 * A game one of your channels carries opens the picker on its feeds (the
 * same step as taking it in the picker). A game none of them carries is
 * still a score, so it shows, and does nothing when clicked. A game already
 * on the grid is marked.
 */
export function MvScoresRow({
  games,
  looked,
  filtered,
  onGrid,
  onOpen,
  onFilter,
}: {
  games: Fixture[];
  /** Whether an answer has come back: an empty row means a quiet day. */
  looked: boolean;
  /** Whether the filter hides anything, for the empty row's words. */
  filtered: boolean;
  /** Whether a game is on the grid already. */
  onGrid: (g: Fixture) => boolean;
  onOpen: (g: Fixture) => void;
  onFilter: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  // A mouse wheel scrolls the row sideways: it is one line, and most wheels
  // only go up and down. Not passive, so the page underneath stays put.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // And a mouse drags it, as a Stream shelf drags (Adam, v0.10.18: "add
  // click/drag to the score bar"). A drag never opens the card it ends on.
  const dragScroll = useDragScroll(row);

  let league = "";
  return (
    <section className="mvscores" aria-label="Live scores">
      <Hint label="Choose sports">
        <button
          type="button"
          className={"mvscores__filter" + (filtered ? " is-filtered" : "")}
          aria-label="Choose sports"
          onClick={onFilter}
        >
          <LeaguesIcon size={18} />
        </button>
      </Hint>
      <div className="mvscores__row" ref={row} {...dragScroll}>
        {games.length === 0 ? (
          <p className="mvscores__empty">
            {!looked
              ? "Looking for live games…"
              : filtered
                ? "No live games in the sports you picked."
                : "No live games right now."}
          </p>
        ) : (
          games.map((g) => {
            const first = g.leagueKey !== league;
            league = g.leagueKey;
            const on = onGrid(g);
            const can = g.channels.length > 0;
            return (
              <Fragment key={g.id}>
                {first && <span className="mvscores__league">{g.league}</span>}
                {/* The reason a game does nothing, on the wrapper: the card
                  * has its own hint (the teams), and an idle card lets the
                  * pointer through to this one (player.css). */}
                <div
                  className={"mvscores__game" + (on ? " is-on" : "") + (can ? "" : " is-off")}
                  data-hint={can ? undefined : "None of your channels carry it"}
                >
                  <CompactCard game={g} onOpen={can ? () => onOpen(g) : undefined} />
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </section>
  );
}
