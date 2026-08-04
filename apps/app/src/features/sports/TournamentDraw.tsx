import { useMemo, useState } from "react";
import { carriageText } from "./carriage";
import { GameCard } from "./GameCard";
import { UpcomingCard } from "./UpcomingCard";
import { BackArrowIcon } from "../../ui/icons";
import type { Fixture, Tournament } from "./model";

/**
 * A tournament's day, opened (plan 010 #38).
 *
 * WHY IT IS A LIST AND NOT A GRID. A real day measured on the National
 * Bank Open: 39 matches across 10 courts, and the peak day of that
 * fortnight carried 89. The board already learned this lesson twice —
 * cards at that count are a wall you scroll rather than a thing you read.
 * A tennis match is two names and a line of sets, which is a row.
 *
 * STATUS FIRST, which is Adam's and is the question the whole hub is built
 * around. Live at the top, then what is still to come in time order, then
 * results. The alternative orderings both bury it: by court puts the four
 * live matches across four of ten sections, and by draw puts them inside
 * two long lists. The draw becomes a filter instead, which narrows without
 * re-sectioning.
 *
 * WHAT IT CANNOT DO, said plainly because it is the app's usual promise:
 * there is nothing to play. Measured across all 284 matches of a real
 * tournament, `broadcasts` and `geoBroadcasts` are empty on every single
 * one, so no row can offer a channel. The tournament as a whole can, and
 * that is where the carriage line lives — one honest answer at the top
 * rather than 39 blank ones down the side.
 */

/** The three sections, in the order they answer "what can I watch". */
const SECTIONS: { key: Fixture["state"]; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "pre", label: "Upcoming" },
  { key: "final", label: "Results" },
];

export function TournamentDraw({
  event,
  onClose,
}: {
  event: Tournament;
  onClose: () => void;
}) {
  /** The draw being shown, or everything. */
  const [draw, setDraw] = useState<string | null>(null);

  const shown = useMemo(
    () => (draw ? event.matches.filter((m) => m.draw === draw) : event.matches),
    [event.matches, draw],
  );

  /**
   * The three buckets, each in kick-off order.
   *
   * Results READ BACKWARDS, most recent first, because a finished match is
   * something you are catching up on and the last one to end is the one
   * you missed by the least. Everything else reads forwards.
   */
  const buckets = useMemo(
    () =>
      SECTIONS.map((s) => {
        const games = shown.filter((m) => m.state === s.key);
        games.sort((a, b) =>
          s.key === "final"
            ? b.start.getTime() - a.start.getTime()
            : a.start.getTime() - b.start.getTime(),
        );
        return { ...s, games };
      }).filter((s) => s.games.length > 0),
    [shown],
  );

  return (
    <div className="tourndraw">
      <header className="tourndraw__top">
        <button
          type="button"
          className="tourndraw__back"
          aria-label="Back to the board"
          onClick={onClose}
        >
          <BackArrowIcon />
        </button>
        <div className="tourndraw__titles">
          <h2 className="tourndraw__title">{event.title}</h2>
          <p className="tourndraw__where">
            {[event.venue, event.rounds.join(" · ")].filter(Boolean).join(" · ")}
          </p>
        </div>
        {/* The one carriage answer this screen can honestly give. The
          * matches carry no broadcast at all, so it is resolved against the
          * TOURNAMENT and said once, in the app's own words for it. */}
        <p className="tourndraw__carriage">{carriageText(event)}</p>
      </header>

      {/* Only where there is a choice: one draw and this is a row of one
        * chip that does nothing. */}
      {event.draws.length > 1 && (
        <div className="tourndraw__draws">
          <Chip on={draw === null} onClick={() => setDraw(null)}>
            All
          </Chip>
          {event.draws.map((d) => (
            <Chip key={d} on={draw === d} onClick={() => setDraw(d)}>
              {d}
            </Chip>
          ))}
        </div>
      )}

      {buckets.map((bucket) => (
        <section className="tourndraw__section" key={bucket.key}>
          <h3 className="tourndraw__heading">
            {bucket.key === "live" && <span className="gamepip" aria-hidden />}
            {bucket.label}
            {/* The count, because "how much of this day is left" is the
              * other question someone opening a draw is asking. */}
            <span className="tourndraw__count">{bucket.games.length}</span>
          </h3>
          {/* THE BOARD'S OWN CARDS, which is Adam's call and the right
            * one: a tennis match is two sides and a score, so it should be
            * the object the rest of the hub already uses rather than a
            * fourth thing that looks similar. The board's own split too —
            * wide cards for what is on now, the small card's grid for a
            * day — so this screen reads as the hub at a different
            * altitude instead of as a separate app. */}
          {bucket.key === "live" ? (
            <div className="tourndraw__wides">
              {bucket.games.map((match) => (
                <GameCard key={match.id} game={match} />
              ))}
            </div>
          ) : (
            <div className="sports__grid">
              {bucket.games.map((match) => (
                <UpcomingCard key={match.id} game={match} />
              ))}
            </div>
          )}
        </section>
      ))}

      {shown.length === 0 && (
        <p className="tourndraw__none">Nothing in this draw today.</p>
      )}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={"tourndraw__chip" + (on ? " is-on" : "")}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
