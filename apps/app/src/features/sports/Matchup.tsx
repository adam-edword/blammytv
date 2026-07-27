import { useFitText } from "../../lib/fitText";
import { Badge } from "./Badge";
import type { Game } from "./model";

/**
 * The two teams, at the head of the theater's panel (plan 010).
 *
 * Its own component rather than markup borrowed from the cards, and the
 * reason shows in what it does NOT have. A card is an object in a grid: it
 * needs a border to be an object, a colour wash to be picked out at a glance
 * across a board of them, and a diagonal layout because two names splitting
 * a 315px box get 123px each. None of that reasoning survives here. There is
 * exactly one matchup on screen and it is the title of the thing you are
 * already watching.
 *
 * So it is the two teams and nothing else: no wash, no crest art, no scrim
 * to darken art that is no longer there, no border, no radius, no lean. The
 * player beside it is the picture.
 *
 * Badge stays, deliberately: it is the primitive for "a team's mark" rather
 * than a card part, and it carries the inverted-crest fallback that a second
 * copy would get wrong.
 */
export function Matchup({ game }: { game: Game }) {
  const { home, away } = game;
  // In line, the two names share one row instead of owning a whole one
  // each, so the long pairings are much tighter than on any card:
  // "Golden Knights" against "Diamondbacks" is the worst the five leagues
  // offer. Fitted as a group so they shrink together and stay peers.
  const homeText = home.shortName ?? home.name;
  const awayText = away.shortName ?? away.name;
  const [homeName, awayName] = useFitText<HTMLSpanElement>(homeText, awayText);

  return (
    <header className="matchup">
      <span className="matchup__team">
        <Badge team={home} />
        <span className="matchup__label">
          <span className="matchup__abbr">{home.abbr}</span>
          <span className="matchup__name" ref={homeName}>
            {homeText}
          </span>
        </span>
      </span>

      <span className="matchup__team matchup__team--away">
        <span className="matchup__label matchup__label--away">
          <span className="matchup__abbr">{away.abbr}</span>
          <span className="matchup__name" ref={awayName}>
            {awayText}
          </span>
        </span>
        <Badge team={away} />
      </span>
    </header>
  );
}
