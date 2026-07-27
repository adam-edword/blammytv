import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { useFitText } from "../../lib/fitText";
import { formatClock } from "../../lib/time";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { Badge } from "./Badge";
import { Wash, WashVeil } from "./Wash";
import { loser } from "./result";
import type { Game } from "./model";

/**
 * A game on today's row, as one wide card (plan 010).
 *
 * ONE card for all three states, because the row it lives in is the day in
 * order and a game crosses those states while you are looking at it. What
 * changes is only what the middle column can honestly say:
 *
 *   pre    the kick-off time, and no score, because there is not one
 *   live   the clock and the running score
 *   final  "Final" and the score it finished on
 *
 * The whole card is the target: the object here is the GAME, and every
 * click means "watch this", so there is nothing else on it to hit. Which
 * channel it tunes is a decision the card makes on your behalf, and the
 * player's channel rail is where that decision gets revised.
 */

function GameCardImpl({
  game,
  onOpen,
}: {
  game: Game;
  onOpen?: (game: Game) => void;
}) {
  const { home, away } = game;
  // The broadcast name, as on the small card: "Seahawks" is what a screen
  // full of games should say, and the full club name only ever pushed the
  // score around. The tooltip still carries both in full.
  const homeText = home.shortName ?? home.name;
  const awayText = away.shortName ?? away.name;
  // Roomier than the small card, so this rarely fires, but a long name
  // still must not take room from the score.
  const [homeName, awayName] = useFitText<HTMLSpanElement>(homeText, awayText);
  const lost = loser(game);
  // What the bottom-right says. One channel names it; several advertise the
  // choice, because being able to hop is the reason to use this tab. "Live
  // on" only where it is true: a game at 8:30 is not live on anything yet.
  const on = game.state === "live" ? "Live on" : "On";
  const carriage =
    game.channels.length === 0
      ? game.broadcasts.length > 0
        ? `On ${game.broadcasts[0]}`
        : "Not on your channels"
      : game.channels.length === 1
        ? `${on} ${game.channels[0].name}`
        : `${on} ${game.channels.length} channels`;

  return (
    <button
      type="button"
      className="gamecard"
      // The row centres itself on one of these; see SportsScreen.
      data-game={game.id}
      title={`${home.name} vs ${away.name}`}
      onClick={() => onOpen?.(game)}
    >
      {/* Same lean and glare as the poster cards, at a much smaller angle.
       * Degrees are not the unit that matters: a 650px card sweeps far
       * more pixels at its corners than a 300px poster does at the same
       * angle, so matching the poster's 5deg here read as a barn door.
       * The glare is lighter than a poster's for the same reason: it
       * sweeps a much larger area, so the same opacity reads as a much
       * brighter wipe. The radius is repeated from the stylesheet because
       * the glare is its own layer with its own clip and the library takes
       * it as a string prop; a mismatch shows as a square sheen poking out
       * of a round corner. */}
      <Tilt
        className="gamecard__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={1.5}
        tiltMaxAngleY={1.5}
        scale={REDUCED_MOTION ? 1 : 1.01}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.07}
        glarePosition="all"
        glareBorderRadius="63.9px"
      >
        <Wash side="home" team={home} lost={lost === "home"} haze />
        <Wash side="away" team={away} lost={lost === "away"} haze />
        <span className="gamecard__scrim" aria-hidden />

        <span className="gamecard__body">
          <span
            className={
              "gamecard__team gamecard__team--home" +
              (lost === "home" ? " gamecard__team--lost" : "")
            }
          >
            <Badge team={home} />
            <span className="gamecard__label">
              <span className="gamecard__abbr">{home.abbr}</span>
              <span className="gamecard__name" ref={homeName}>
                {homeText}
              </span>
            </span>
          </span>

          <span className="gamecard__center">
            <span
              className={
                "gamecard__status" +
                // Alone in the column when there is no score under it, so
                // it takes the weight the score would have carried.
                (game.state === "pre" ? " gamecard__status--alone" : "")
              }
            >
              {game.state === "live" && (
                <span className="gamepip" aria-hidden />
              )}
              {game.status}
            </span>
            {game.state !== "pre" && (
              <span className="gamecard__score">
                <span
                  className={
                    "gamecard__num" +
                    (lost === "home" ? " gamecard__num--lost" : "")
                  }
                >
                  {home.score ?? 0}
                </span>
                <span className="gamecard__dash" aria-hidden>
                  -
                </span>
                <span
                  className={
                    "gamecard__num" +
                    (lost === "away" ? " gamecard__num--lost" : "")
                  }
                >
                  {away.score ?? 0}
                </span>
              </span>
            )}
            <span className="gamecard__league">{game.league}</span>
          </span>

          <span
            className={
              "gamecard__team gamecard__team--away" +
              (lost === "away" ? " gamecard__team--lost" : "")
            }
          >
            <Badge team={away} />
            <span className="gamecard__label">
              <span className="gamecard__abbr">{away.abbr}</span>
              <span className="gamecard__name" ref={awayName}>
                {awayText}
              </span>
            </span>
          </span>
        </span>

        <span className="gamecard__foot">
          {game.venue && (
            <span className="gamecard__venue">
              <PinIcon />
              {game.venue}
            </span>
          )}
          {/* A finished game has nothing to tune into, so it says when it
           * started instead of where to watch it: "On MLB.TV" under a
           * full-time score is an invitation to watch something already
           * over. ESPN carries no end time, or this would say that. */}
          {game.state === "final" ? (
            <span className="gamecard__carriage gamecard__carriage--none">
              Started {formatClock(game.start)}
            </span>
          ) : (
            <span
              className={
                "gamecard__carriage" +
                (game.channels.length === 0 ? " gamecard__carriage--none" : "")
              }
            >
              {game.state === "live" && game.channels.length > 0 && (
                <span className="gamecard__dot" aria-hidden />
              )}
              {carriage}
              {game.channels.length > 1 && (
                <span className="gamecard__more" aria-hidden>
                  &rsaquo;
                </span>
              )}
            </span>
          )}
        </span>
        <WashVeil home={home} away={away} lost={lost} />
      </Tilt>
    </button>
  );
}

function PinIcon() {
  return (
    <svg
      width="9"
      height="11"
      viewBox="0 0 9 11"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <path
        d="M4.5.75c2 0 3.5 1.5 3.5 3.4 0 2.4-3.5 6.1-3.5 6.1S1 6.55 1 4.15C1 2.25 2.5.75 4.5.75Z"
        stroke="currentColor"
        strokeWidth="1"
      />
      <circle cx="4.5" cy="4.15" r="1.15" fill="currentColor" />
    </svg>
  );
}

/**
 * Memoised on the game's identity. The board rebuilds its games from
 * fresh JSON every 90 seconds and almost none of them have changed;
 * useGames carries the unchanged ones forward as the SAME object so a
 * plain shallow compare is enough here. Without it a quiet tick
 * re-rendered every card on screen and rewrote every tilt transform.
 */
export const GameCard = memo(GameCardImpl);
