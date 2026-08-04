import { memo } from "react";
import Tilt from "react-parallax-tilt";
import { useFitText } from "../../lib/fitText";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { tooEarly } from "./day";
import { Badge } from "./Badge";
import { Wash, WashVeil } from "./Wash";
import { loser } from "./result";
import { givenName, isMatch, setColumns, surname } from "./sets";
import type { Competitor, Fixture, Game } from "./model";

/**
 * A game as a small card, for a day at a glance (plan 010).
 *
 * The day grids use it for every state, so it carries a score once there is
 * one, at the outer end of each team's row where a scorecard puts it. What
 * it never carries is the "live on" line: this card is for reading a day,
 * and the wide card in the row above is where a game is chosen.
 *
 * A fixture is STAGGERED, home to the top left and away to the bottom
 * right, rather than split down the middle. Two reasons, and the first is
 * the one that matters: split, each name got 123px and the long ones had to
 * be shrunk to fit. Staggered, each gets the card less one badge, about
 * 210px, and "Wolverhampton" measures 211px at full size. The fit is back
 * to being a safety net. The second is that a diagonal reads as a matchup,
 * where a symmetric split reads as two columns.
 *
 * A game with a SCORE squares up instead: both marks left, both names on
 * one edge, both numbers in a column on the other. Numbers are compared,
 * and comparing them across a diagonal is work. The stagger is for the
 * cards where there is nothing to compare yet.
 *
 * Same object as the live card, smaller and quieter. Not a variant flag on
 * it: the two share the wash and nothing else, and a single component
 * branching on state would be mostly branches.
 *
 * A finished game is dimmed as a whole and the beaten side is set in a
 * light weight, so a grid of results can be read for who won without
 * reading a single number.
 */
function UpcomingCardImpl({
  game,
  onOpen,
  when,
}: {
  game: Fixture;
  onOpen?: (game: Game) => void;
  /**
   * The date, for a card that is NOT under a dated heading: "OCT 3".
   *
   * Only the "Coming up" section passes it (plan 010 #36). Everywhere else
   * the day grid names the day above the card, and repeating it on every
   * card would be noise; there, a game two months out would otherwise
   * read as a kick-off time with nothing to anchor it.
   */
  when?: string;
}) {
  const { home, away } = game;
  /**
   * A tennis match keeps its SURNAME on the big line and its given name on
   * the small one, where a club keeps its short name and its abbreviation.
   * Same two lines at the same sizes; see SetLine.
   */
  const sets = isMatch(game);
  const columns = sets ? setColumns(home, away) : 0;
  // Half a small card each, so this takes the broadcast name where there is
  // one: "Man City" is what a viewer scanning fixtures reads anyway. The
  // fit below is the safety net for whatever the feed still sends long.
  const homeText = sets ? surname(home) : (home.shortName ?? home.name);
  const awayText = sets ? surname(away) : (away.shortName ?? away.name);
  const [homeName, awayName] = useFitText<HTMLSpanElement>(homeText, awayText);
  const lost = loser(game);
  // Live or finished: there is a score, so the card squares up.
  const scored = game.state !== "pre" || sets;
  const early = tooEarly(game);
  return (
    <button
      type="button"
      className={
        "upcard" +
        // Two layouts, not two components: a game with numbers on it reads
        // as a table, a fixture without reads as a matchup.
        (scored ? " upcard--scored" : "") +
        (game.state === "final" ? " upcard--final" : "") +
        (early ? " sportscard--early" : "")
      }
      // The wire's own line about the fixture, where there is one. It is 60
      // to 80 characters, which no card face here has room for, and a
      // tooltip is exactly the place for a sentence you can choose to read.
      title={
        game.headline
          ? `${home.name} vs ${away.name}\n${game.headline}`
          : `${home.name} vs ${away.name}`
      }
      // Focus comes back here when the theater closes; see SportsScreen.
      data-game={game.id}
      // Too far out to be an action. See tooEarly: opening it would tune a
      // channel and label the chrome with a fixture that has not happened.
      // `disabled` rather than a bare missing handler, so it leaves the tab
      // order and announces itself instead of looking live and doing
      // nothing.
      disabled={early}
      onClick={() => onOpen?.(game)}
    >
      {/* Steeper than the live card's 1.5deg, and deliberately so: degrees
        * are not the unit that matters, pixels swept at the corner are. At
        * a third of the live card's width the same angle is a third of the
        * movement, which read as glare with no card under it. */}
      <Tilt
        className="upcard__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={7}
        tiltMaxAngleY={7}
        scale={REDUCED_MOTION ? 1 : 1.03}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.09}
        glarePosition="all"
        glareBorderRadius="42.6px"
      >
        <Wash side="home" team={home} lost={lost === "home"} />
        <Wash side="away" team={away} lost={lost === "away"} />
        <span className="upcard__scrim" aria-hidden />

        <span className="upcard__body">
          {/* Status and competition on one line across the top, which buys
            * the height the card gives back and reads as a scoreboard's
            * header rather than as two stray labels. */}
          <span className="upcard__head">
            <span className="upcard__time">
              {game.state === "live" && <span className="gamepip" aria-hidden />}
              {when && <span className="upcard__when">{when}</span>}
              {game.status}
            </span>
            <span className="upcard__league">
              {sets ? (game.venue ?? game.league) : game.league}
            </span>
          </span>
          <span className="upcard__teams">
            <span
              className={
                "upcard__team" + (lost === "home" ? " upcard__team--lost" : "")
              }
            >
              <Badge team={home} />
              <span className="upcard__label">
                <span className="upcard__abbr">
                  {sets ? givenName(home) : home.abbr}
                  {/* Beside the code rather than under the name: the label
                    * is a two-line column on a card this size and a third
                    * line would take the room the name needs. "BAL 59-53"
                    * is one short line, and it is the line this treatment
                    * already exists for. */}
                  {home.record && (
                    <span className="upcard__record">{home.record}</span>
                  )}
                </span>
                <span className="upcard__name" ref={homeName}>
                  {homeText}
                </span>
              </span>
              {sets ? (
                <SetLine team={home} columns={columns} />
              ) : (
                scored && <span className="upcard__score">{home.score ?? 0}</span>
              )}
            </span>
            <span
              className={
                "upcard__team upcard__team--away" +
                (lost === "away" ? " upcard__team--lost" : "")
              }
            >
              <Badge team={away} />
              <span className="upcard__label">
                <span className="upcard__abbr">
                  {sets ? givenName(away) : away.abbr}
                  {away.record && (
                    <span className="upcard__record">{away.record}</span>
                  )}
                </span>
                <span className="upcard__name" ref={awayName}>
                  {awayText}
                </span>
              </span>
              {sets ? (
                <SetLine team={away} columns={columns} />
              ) : (
                scored && <span className="upcard__score">{away.score ?? 0}</span>
              )}
            </span>
          </span>
        </span>
        <WashVeil home={home} away={away} lost={lost} />
      </Tilt>
    </button>
  );
}

/**
 * One player's sets, as a row of fixed columns.
 *
 * FIXED columns rather than natural width, so the two players' lines stack
 * into a grid: a card where the second set sits under the first set on one
 * row and under the third on the other is not a scoreboard.
 */
function SetLine({ team, columns }: { team: Competitor; columns: number }) {
  return (
    <span className="upcard__sets">
      {Array.from({ length: columns }, (_, i) => {
        const set = team.sets?.[i];
        return (
          <span
            className={
              "setline__set" + (set?.won === false ? " setline__set--lost" : "")
            }
            key={i}
          >
            {/* Empty rather than zero for a set not yet played: nothing has
              * happened, and a 0 is a claim that it has. */}
            {set ? set.games : ""}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Memoised on the game's identity. The board rebuilds its games from
 * fresh JSON every 90 seconds and almost none of them have changed;
 * useGames carries the unchanged ones forward as the SAME object so a
 * plain shallow compare is enough here. Without it a quiet tick
 * re-rendered every card on screen and rewrote every tilt transform.
 */
export const UpcomingCard = memo(UpcomingCardImpl);
