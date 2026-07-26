import { useEffect, useRef } from "react";
import { RowScroller } from "../stream/StreamScreen";
import { GameCard } from "./GameCard";
import { useGames } from "./useGames";
import type { Game } from "./model";

/**
 * The Sports hub (plan 010): games as the objects, your channels hanging
 * off them.
 *
 * ONE row for the day, in kick-off order, the way a guide reads: finished,
 * then whatever is on, then what is still to come. Games were split into
 * three rows by state before, which meant the same day was told three
 * times and a game silently jumped rows when it started. A day is a
 * timeline, so it is drawn as one.
 *
 * The row opens centred on NOW, which is the live game or, when nothing is
 * on, the one that finished last. Otherwise it would open on breakfast.
 *
 * The row reuses Stream's RowScroller so the scroll behaviour, the fade and
 * the drag-to-scroll are the same object language as everywhere else.
 */
export function SportsScreen() {
  const { games, state } = useGames();

  const today = [...games].sort((a, b) => a.start.getTime() - b.start.getTime());
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
    const c = card.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollLeft += c.left + c.width / 2 - (b.left + b.width / 2);
  }, [anchor]);

  return (
    <div className="discover sports">
      {today.length > 0 && (
        <section className="media-row" ref={row}>
          <h3 className="media-row__title sports__title">
            {/* The pip is a claim about the world, so it only appears when
              * something is actually on. */}
            {live && <span className="sports__live-dot" aria-hidden />}
            Today&rsquo;s Games
          </h3>
          <RowScroller>
            {today.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </RowScroller>
        </section>
      )}

      {today.length === 0 && (
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
