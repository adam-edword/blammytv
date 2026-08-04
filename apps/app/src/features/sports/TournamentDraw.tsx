import { useEffect, useMemo, useState } from "react";
import { carriageText, carriageUnlinked } from "./carriage";
import { GameCard } from "./GameCard";
import { UpcomingCard } from "./UpcomingCard";
import { BackArrowIcon, WarnIcon } from "../../ui/icons";
import { useMouseNav } from "../../lib/mouseNav";
import { isTauri, tauriIsFullscreen } from "../../lib/tauri";
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
  /**
   * The mouse's back button, which is how people actually leave a screen
   * like this.
   *
   * Adam, on the tennis draw: "can only get back by hitting the back button
   * in the top left." This screen is a full-screen view pushed over the
   * board — the same shape as the theater, which opted into this hook when
   * it was written — and it was the one such view that never did, so the
   * arrow was the only way out.
   *
   * Back only. There is nothing to go forward TO: the draw is one level
   * deep over the board, and the screen it came from is the only other
   * place. A forward handler here would either do nothing or re-open a
   * tournament nobody asked for.
   */
  useMouseNav(onClose);

  /**
   * Escape, with the theater's own fullscreen rule.
   *
   * The guard is not defensive. App.tsx exits the WINDOW's fullscreen on
   * Escape, and the window-state plugin restores fullscreen across
   * launches, so the app can be fullscreen without this screen knowing.
   * Closing unconditionally would spend one Escape on both — dropping out
   * of fullscreen AND losing your place in a 105 match draw — which is the
   * exact bug SportsTheater's handler documents. All this has to do is not
   * ALSO leave. No answer from the window means stay put, for the same
   * reason: leaving on a maybe is the bad half of that bug.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!isTauri()) {
        onClose();
        return;
      }
      void tauriIsFullscreen().then(
        (full) => {
          if (!full) onClose();
        },
        () => undefined,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  /*
   * `sports` as well as `tourndraw`, and it is not cosmetic: the whole type
   * scale these cards are built on — --sports-name, --sports-score,
   * --sports-meta — is declared on that class. Without it every card in
   * here fell back to the browser's 16px, so surnames rendered at 16
   * instead of 28 and `calc(var(--sports-name) / 1.27)` was not a length at
   * all. The cards read as wrongly proportioned and the cause was that they
   * were never handed the proportions.
   */
  return (
    <div className="sports tourndraw">
      {/* ONE sticky block, not two sticky siblings. The title row and the
        * draw chips have to travel together — sticking them separately
        * would mean giving the chips a `top` equal to the title row's
        * height, which is a number that changes with the tournament name's
        * wrap and would have them overlap the moment one went to two
        * lines. A wrapper has no such number in it. */}
      <div className="tourndraw__head">
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
              {[event.venue, event.rounds.join(" · ")]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {/* The one carriage answer this screen can honestly give. The
            * matches carry no broadcast at all, so it is resolved against
            * the TOURNAMENT and said once, in the app's own words for it.
            *
            * Carries the pill for the same reason the cards do: this line
            * is the only place the screen says whether there is anything
            * to watch on, so "nothing to press" has to be visible here or
            * it is nowhere. On a tournament with no map row the pill is
            * the entire answer, since carriageText has nothing to say. */}
          <p className="tourndraw__carriage">
            {carriageText(event)}
            {carriageUnlinked(event) && (
              <span className="gamecard__unlinked">
                <WarnIcon size={11} />
                Couldn&rsquo;t link
              </span>
            )}
          </p>
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
      </div>

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
