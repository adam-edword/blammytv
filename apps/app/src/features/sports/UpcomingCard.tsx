import Tilt from "react-parallax-tilt";
import { useFitText } from "../../lib/fitText";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { scaledRadius } from "./scale";
import { Badge } from "./Badge";
import { Wash, WashVeil } from "./Wash";
import type { Game } from "./model";

/**
 * A game that has not started, as a small card (plan 010).
 *
 * The live card's information does not exist yet: no score, no clock, and
 * no "live on" line, because which channel carries it is only worth
 * claiming once it is on. What is left is the matchup, when it starts, and
 * what competition it belongs to, which is exactly what someone scanning a
 * day of fixtures is reading for.
 *
 * The two sides are STAGGERED, home to the top left and away to the bottom
 * right, rather than split down the middle. Two reasons, and the first is
 * the one that matters: split, each name got 123px and the long ones had to
 * be shrunk to fit. Staggered, each gets the card less one badge, about
 * 210px, and "Wolverhampton" measures 211px at full size. The fit is back
 * to being a safety net. The second is that a diagonal reads as a matchup,
 * where a symmetric split reads as two columns.
 *
 * Same object as the live card, smaller and quieter. Not a variant flag on
 * it: the two share the wash and nothing else, and a single component
 * branching on state would be mostly branches.
 *
 * UNREFERENCED at the moment, and deliberately kept. Today's row merged
 * into one guide-style timeline of wide cards, which is where the small
 * card used to be used. It is what the "Tomorrow" and later-day rows in
 * the design are drawn with, and those are waiting on the adapter being
 * able to ask for a date other than today. Delete it if that changes.
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
  return (
    <button
      type="button"
      className="upcard"
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
        glareBorderRadius={scaledRadius(30)}
      >
        <Wash side="home" team={home} />
        <Wash side="away" team={away} />
        <span className="upcard__scrim" aria-hidden />

        <span className="upcard__body">
          <span className="upcard__time">{game.status}</span>
          <span className="upcard__teams">
            <span className="upcard__team">
              <Badge team={home} />
              <span className="upcard__label">
                <span className="upcard__abbr">{home.abbr}</span>
                <span className="upcard__name" ref={homeName}>
                  {homeText}
                </span>
              </span>
            </span>
            <span className="upcard__team upcard__team--away">
              <Badge team={away} />
              <span className="upcard__label">
                <span className="upcard__abbr">{away.abbr}</span>
                <span className="upcard__name" ref={awayName}>
                  {awayText}
                </span>
              </span>
            </span>
          </span>
          <span className="upcard__league">{game.league}</span>
        </span>
        <WashVeil home={home} away={away} />
      </Tilt>
    </button>
  );
}
