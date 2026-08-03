import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { useFitText } from "../../lib/fitText";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { tooEarly } from "./day";
import { Badge } from "./Badge";
import { Wash, WashVeil } from "./Wash";
import { loser } from "./result";
import { CardFoot } from "./CardFoot";
import { carriageText } from "./carriage";
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
  // Where to watch it, for the label below. The foot draws its own copy;
  // this one is only so the accessible name carries it too.
  const carriage = carriageText(game);
  const early = tooEarly(game);
  return (
    <button
      type="button"
      className={"gamecard" + (early ? " sportscard--early" : "")}
      // The row centres itself on one of these; see SportsScreen.
      data-game={game.id}
      // The wire's own line about the fixture. 60 to 80 characters, which
      // is a sentence rather than a label, so it goes where a sentence can
      // be chosen rather than onto the card face.
      title={
        game.headline
          ? `${home.name} vs ${away.name}\n${game.headline}`
          : `${home.name} vs ${away.name}`
      }
      // The scoreline does NOT survive the DOM order: the dash is
      // aria-hidden, so the two numbers collapse together between the two
      // names and neither is attached to a team. The one thing this card
      // exists to say was the one thing lost. Same shape as Guide.tsx.
      // The note is on the card face, so it is in here too: "CLE leads
      // series 2-0" is the reason to pick this game and it must not be
      // sighted-only.
      aria-label={
        (game.state === "pre"
          ? `${home.name} versus ${away.name}. ${game.status}. ${game.league}.`
          : `${home.name} ${home.score ?? 0}, ${away.name} ${away.score ?? 0}. ${game.status}. ${game.league}.`) +
        (game.note ? ` ${game.note}.` : "") +
        ` ${carriage}`
      }
      // Too far out to be an action. See tooEarly: opening it would tune a
      // channel and label the chrome with a fixture that has not happened.
      // `disabled` rather than a bare missing handler, so it leaves the tab
      // order and announces itself instead of looking live and doing
      // nothing.
      disabled={early}
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
              <span className="gamecard__abbr">
                {home.abbr}
                {/* Beside the code, same as the small card. The label is a
                  * two-line column and the name below it is the widest
                  * thing on this half of the card. */}
                {home.record && (
                  <span className="gamecard__record">{home.record}</span>
                )}
              </span>
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
            {/* WHY THIS ONE. Rare (14 of 182 events measured) and the most
              * important thing on the card when it is there: a playoff
              * series state, or the occasion. Only on the wide card, which
              * is where a game gets CHOSEN — the small card is for reading
              * a day and says so in its own doc. */}
            {game.note && <span className="gamecard__note">{game.note}</span>}
          </span>

          <span
            className={
              "gamecard__team gamecard__team--away" +
              (lost === "away" ? " gamecard__team--lost" : "")
            }
          >
            <Badge team={away} />
            <span className="gamecard__label">
              <span className="gamecard__abbr">
                {away.abbr}
                {away.record && (
                  <span className="gamecard__record">{away.record}</span>
                )}
              </span>
              <span className="gamecard__name" ref={awayName}>
                {awayText}
              </span>
            </span>
          </span>
        </span>

        <CardFoot item={game} place={game.venue} start={game.start} />
        <WashVeil home={home} away={away} lost={lost} />
      </Tilt>
    </button>
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
