import Tilt from "react-parallax-tilt";
import { REDUCED_MOTION } from "../../lib/reducedMotion";
import type { Competitor, Game } from "./model";

/**
 * A live game, as one wide card (plan 010).
 *
 * The whole card is the target: the object here is the GAME, and every
 * click means "watch this", so there is nothing else on it to hit. Which
 * channel it tunes is a decision the card makes on your behalf, and the
 * player's channel rail is where that decision gets revised.
 *
 * Soccer only for now. Every sport reads its clock and its score
 * differently (quarters, innings, minutes, laps), and one card trying to
 * cover all of them ends up covering none of them well, so `sport` picks a
 * layout rather than a set of flags.
 */

/** The wash behind each half: the competitor's mark, blurred hard and
 * bled off its own edge, tinted by the team colour. A missing logo leaves
 * the tint, which is why the tint is a separate layer. */
function Wash({ side, team }: { side: "home" | "away"; team: Competitor }) {
  return (
    <span className={`gamecard__wash gamecard__wash--${side}`} aria-hidden>
      {team.color && (
        <span
          className="gamecard__tint"
          style={{ background: `#${team.color}` }}
        />
      )}
      {team.logo && (
        <img className="gamecard__mark" src={team.logo} alt="" loading="lazy" />
      )}
    </span>
  );
}

export function GameCard({
  game,
  onOpen,
}: {
  game: Game;
  onOpen?: (game: Game) => void;
}) {
  const { home, away } = game;
  // What the bottom-right says. One channel names it; several advertise the
  // choice, because being able to hop is the reason to use this tab.
  const carriage =
    game.channels.length === 0
      ? game.broadcasts.length > 0
        ? `On ${game.broadcasts[0]}`
        : "Not on your channels"
      : game.channels.length === 1
        ? `Live on ${game.channels[0].name}`
        : `Live on ${game.channels.length} channels`;

  return (
    <button
      type="button"
      className="gamecard"
      title={`${home.name} vs ${away.name}`}
      onClick={() => onOpen?.(game)}
    >
      {/* Same lean and glare as the poster cards, at a much smaller angle.
        * Degrees are not the unit that matters: a 650px card sweeps far
        * more pixels at its corners than a 300px poster does at the same
        * angle, so matching the poster's 5deg here read as a barn door.
        * Radius tracks THIS card's corner: the glare layer is clipped by
        * its own, not by the button's. */}
      <Tilt
        className="gamecard__tilt"
        tiltEnable={!REDUCED_MOTION}
        tiltMaxAngleX={1.5}
        tiltMaxAngleY={1.5}
        scale={REDUCED_MOTION ? 1 : 1.01}
        transitionSpeed={650}
        glareEnable={!REDUCED_MOTION}
        glareMaxOpacity={0.12}
        glarePosition="all"
        glareBorderRadius="24px"
      >
        <Wash side="home" team={home} />
        <Wash side="away" team={away} />
        <span className="gamecard__scrim" aria-hidden />

        <span className="gamecard__body">
          <span className="gamecard__team gamecard__team--home">
            <span className="gamecard__abbr">{home.abbr}</span>
            <span className="gamecard__name">{home.name}</span>
          </span>

          <span className="gamecard__center">
            <span className="gamecard__status">{game.status}</span>
            <span className="gamecard__score">
              <span className="gamecard__num">{home.score ?? 0}</span>
              <span className="gamecard__dash" aria-hidden>
                -
              </span>
              <span className="gamecard__num">{away.score ?? 0}</span>
            </span>
            <span className="gamecard__league">{game.league}</span>
          </span>

          <span className="gamecard__team gamecard__team--away">
            <span className="gamecard__abbr">{away.abbr}</span>
            <span className="gamecard__name">{away.name}</span>
          </span>
        </span>

        <span className="gamecard__foot">
          {game.venue && (
            <span className="gamecard__venue">
              <PinIcon />
              {game.venue}
            </span>
          )}
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
        </span>
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
