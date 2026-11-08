import { memo } from "react";
import { carriageText, carriageUnlinked } from "../../sports/carriage";
import type { Fixture, Game } from "../../sports/model";
import { inReadingOrder } from "../../sports/order";
import { loser } from "../../sports/result";
import { isMatch, surname } from "../../sports/sets";
import { useTooEarly } from "../../sports/useTooEarly";

/**
 * Fluent's game card: an 8px card with the two sides stacked, the visitors
 * first where the sport reads them so (order.ts), each with a colour square,
 * its name, its record and its score. Drawn here and not in GameCard, which
 * Home, Multi-View and the theater share. A click opens what the other cards
 * open, and "Live on N channels" does the same: opening a game tunes its
 * best channel.
 */
function FluentGameCardImpl({
  game,
  onOpen,
}: {
  game: Fixture;
  onOpen: (game: Game) => void;
}) {
  const shown = inReadingOrder(game);
  const lost = loser(shown);
  const early = useTooEarly(game);
  const match = isMatch(game);
  const n = game.channels.length;
  const carriage = carriageText(game);
  const sides = [
    { side: "home" as const, team: shown.home },
    { side: "away" as const, team: shown.away },
  ];
  const label =
    (game.state === "pre"
      ? `${sides[0].team.name} versus ${sides[1].team.name}. ${game.status}. ${game.league}.`
      : `${sides[0].team.name} ${sides[0].team.score ?? 0}, ${sides[1].team.name} ${sides[1].team.score ?? 0}. ${game.status}. ${game.league}.`) +
    (game.note ? ` ${game.note}.` : "") +
    (carriage ? ` ${carriage}` : "");
  return (
    <div className={"fl-game" + (game.state === "live" ? " fl-game--live" : "")}>
      <button
        type="button"
        className="fl-game__main"
        data-game={game.id}
        data-hint={game.headline ? `${game.home.name} vs ${game.away.name}\n${game.headline}` : undefined}
        aria-label={label}
        disabled={early}
        onClick={() => onOpen(game)}
      >
        {sides.map(({ side, team }) => (
          <span key={side} className={"fl-game__team" + (lost === side ? " is-lost" : "")}>
            <span
              className="fl-game__mark"
              aria-hidden
              style={team.color ? { background: `#${team.color}` } : undefined}
            />
            <span className="fl-game__name">{match ? surname(team) : (team.shortName ?? team.name)}</span>
            {team.record && <span className="fl-game__record">{team.record}</span>}
            {game.state !== "pre" && <span className="fl-game__score">{team.score ?? 0}</span>}
          </span>
        ))}
      </button>
      <div className="fl-game__foot">
        <span className={"fl-game__status" + (game.state === "live" ? " is-live" : "")}>
          {game.state === "live" && <span className="fl-game__dot" aria-hidden />}
          {game.status}
        </span>
        {game.state !== "final" &&
          (n > 0 ? (
            <button type="button" className="fl-link" disabled={early} onClick={() => onOpen(game)}>
              {game.state === "live" ? "Live on" : "On"} {n} {n === 1 ? "channel" : "channels"}
            </button>
          ) : (
            <span className="fl-game__carry">
              {carriage}
              {carriageUnlinked(game) && (carriage ? " · " : "") + "Couldn’t link"}
            </span>
          ))}
      </div>
    </div>
  );
}

/** Memoised on the game's identity, as the other cards are: useGames carries
 * an unchanged game forward as the same object. */
export const FluentGameCard = memo(FluentGameCardImpl);
