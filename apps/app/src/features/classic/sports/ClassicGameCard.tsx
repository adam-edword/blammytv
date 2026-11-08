import { memo } from "react";
import { useTooEarly } from "../../sports/useTooEarly";
import { awayFirst, inReadingOrder } from "../../sports/order";
import { carriageText, carriageUnlinked } from "../../sports/carriage";
import { isMatch, setColumns, surname } from "../../sports/sets";
import type { Competitor, Fixture, Game } from "../../sports/model";

/**
 * A game as Classic's raised grey panel (plan 035, "Classic across the app"):
 * the teams in reading order each with a colour block, the score in a sunken
 * black display with green digits, the state, and where it is on.
 *
 * One panel for the board's small card and its compact line. It is only
 * drawn on the Sports board: Home's row, Multi-View's scores and the theater
 * keep the cards they have. Same data and the same open as UpcomingCard and
 * CompactCard, so a click behaves identically.
 */

/** A team's colour as CSS, or nothing when the feed has none or it isn't hex. */
const swatch = (t: Competitor): string | undefined =>
  t.color && /^[0-9a-f]{3,8}$/i.test(t.color) ? `#${t.color}` : undefined;

function Team({ team, text }: { team: Competitor; text: string }) {
  return (
    <span className="cl-game__team">
      <i className="cl-game__swatch" style={{ background: swatch(team) }} aria-hidden />
      <span className="cl-game__name">{text}</span>
    </span>
  );
}

function ClassicGameCardImpl({
  game,
  onOpen,
  compact,
}: {
  game: Fixture;
  onOpen?: (game: Game) => void;
  /** A finished game as one line, when the board's Compact Results is on. */
  compact?: boolean;
}) {
  const shown = inReadingOrder(game);
  const { home, away } = shown;
  const sets = isMatch(game);
  const text = (t: Competitor) => (sets ? surname(t) : (t.shortName ?? t.name));
  const early = useTooEarly(game);
  // Dim dashes until there is something to show, as a scoreboard does.
  const scored = game.state !== "pre" || sets;
  const readout = !scored
    ? "- - -"
    : sets
      ? Array.from(
          { length: setColumns(home, away) },
          (_, i) => `${home.sets?.[i]?.games ?? ""}-${away.sets?.[i]?.games ?? ""}`,
        ).join(" ")
      : `${home.score ?? 0} - ${away.score ?? 0}`;
  // The card's own live line: "Live on 3 channels", "On ESPN". A finished
  // game has nothing to tune into, so it says nothing here.
  const where = game.state === "final" ? "" : carriageText(game);
  const unlinked = carriageUnlinked(game);
  const carriage = unlinked
    ? `${where ? `${where}, but ` : ""}couldn't link it to any of your channels`
    : where;
  return (
    <button
      type="button"
      className={
        "cl-game" +
        (compact ? " cl-game--compact" : "") +
        (early ? " cl-game--early" : "")
      }
      data-game={game.id}
      data-hint={
        game.headline
          ? `${home.name} vs ${away.name}\n${game.headline}`
          : `${home.name} vs ${away.name}`
      }
      aria-label={
        (game.state === "pre"
          ? `${home.name} versus ${away.name}. ${game.status}. ${game.league}.`
          : `${home.name} ${home.score ?? 0}, ${away.name} ${away.score ?? 0}. ${game.status}. ${game.league}.`) +
        (game.note ? ` ${game.note}.` : "") +
        ` ${carriage}`
      }
      disabled={early || !onOpen}
      onClick={() => onOpen?.(game)}
    >
      {compact ? (
        <>
          <Team team={home} text={home.abbr} />
          <span className="cl-game__led cl-game__led--small" aria-hidden>
            {readout}
          </span>
          <Team team={away} text={away.abbr} />
          <span className="cl-game__state">{game.status}</span>
        </>
      ) : (
        <>
          <Team team={home} text={text(home)} />
          <span className="cl-game__at">{awayFirst(game) ? "at" : "v"}</span>
          <Team team={away} text={text(away)} />
          <span
            className={
              "cl-game__led" +
              (scored ? "" : " cl-game__led--off") +
              (sets ? " cl-game__led--sets" : "")
            }
            aria-hidden
          >
            {readout}
          </span>
          <span className="cl-game__state">
            {game.state === "live" && <span className="gamepip" aria-hidden />}
            {game.status}
          </span>
          <span className={"cl-game__link" + (unlinked ? " cl-game__link--none" : "")}>
            {unlinked ? "Couldn’t link" : where}
          </span>
        </>
      )}
    </button>
  );
}

/** Memoised like the cards it stands in for: useGames hands unchanged games
 * back as the same object, so a quiet tick re-renders none of these. */
export const ClassicGameCard = memo(ClassicGameCardImpl);
