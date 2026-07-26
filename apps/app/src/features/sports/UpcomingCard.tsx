import Tilt from "react-parallax-tilt";
import { useFitText } from "../../lib/fitText";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import { scaledRadius } from "./scale";
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
 * Same object, smaller and quieter. Not a variant flag on the live card:
 * the two share the wash and nothing else, and a single component
 * branching on state would be mostly branches.
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
  // one: "Man City" is what a viewer scanning fixtures reads anyway, and no
  // font size makes "Manchester City" fit in 97px. The fit below is the
  // safety net for whatever the feed still sends long.
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
      <Tilt
        className="upcard__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={3}
        tiltMaxAngleY={3}
        scale={REDUCED_MOTION ? 1 : 1.02}
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
              <span className="upcard__abbr">{home.abbr}</span>
              <span className="upcard__name" ref={homeName}>
                {homeText}
              </span>
            </span>
            <span className="upcard__team upcard__team--away">
              <span className="upcard__abbr">{away.abbr}</span>
              <span className="upcard__name" ref={awayName}>
                {awayText}
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
