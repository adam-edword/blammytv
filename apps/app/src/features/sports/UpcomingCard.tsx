import Tilt from "react-parallax-tilt";
import { useFitText } from "../../lib/fitText";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { Badge } from "./Badge";
import { Wash, WashVeil } from "./Wash";
import { loser } from "./result";
import type { Game } from "./model";

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
export function UpcomingCard({
  game,
  onOpen,
}: {
  game: Game;
  onOpen?: (game: Game) => void;
}) {
  const { home, away } = game;
  // Half a small card each, so this takes the broadcast name where there is
  // one: "Man City" is what a viewer scanning fixtures reads anyway. The
  // fit below is the safety net for whatever the feed still sends long.
  const homeText = home.shortName ?? home.name;
  const awayText = away.shortName ?? away.name;
  const [homeName, awayName] = useFitText<HTMLSpanElement>(homeText, awayText);
  const lost = loser(game);
  // Live or finished: there is a score, so the card squares up.
  const scored = game.state !== "pre";
  return (
    <button
      type="button"
      className={
        "upcard" +
        // Two layouts, not two components: a game with numbers on it reads
        // as a table, a fixture without reads as a matchup.
        (scored ? " upcard--scored" : "") +
        (game.state === "final" ? " upcard--final" : "")
      }
      title={`${home.name} vs ${away.name}`}
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
              {game.status}
            </span>
            <span className="upcard__league">{game.league}</span>
          </span>
          <span className="upcard__teams">
            <span
              className={
                "upcard__team" + (lost === "home" ? " upcard__team--lost" : "")
              }
            >
              <Badge team={home} />
              <span className="upcard__label">
                <span className="upcard__abbr">{home.abbr}</span>
                <span className="upcard__name" ref={homeName}>
                  {homeText}
                </span>
              </span>
              {scored && <span className="upcard__score">{home.score ?? 0}</span>}
            </span>
            <span
              className={
                "upcard__team upcard__team--away" +
                (lost === "away" ? " upcard__team--lost" : "")
              }
            >
              <Badge team={away} />
              <span className="upcard__label">
                <span className="upcard__abbr">{away.abbr}</span>
                <span className="upcard__name" ref={awayName}>
                  {awayText}
                </span>
              </span>
              {scored && <span className="upcard__score">{away.score ?? 0}</span>}
            </span>
          </span>
        </span>
        <WashVeil home={home} away={away} lost={lost} />
      </Tilt>
    </button>
  );
}
