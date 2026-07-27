import { useFitText } from "../../lib/fitText";
import { Badge } from "./Badge";
import { Wash } from "./Wash";
import { loser } from "./result";
import type { Game } from "./model";

/**
 * The two teams, at the head of the theater's panel (plan 010).
 *
 * Its own component rather than markup borrowed from the cards, and the
 * reason shows in the layout it replaces. The header had inherited the
 * small card's DIAGONAL: home to the top left, away to the bottom right.
 * That stagger exists on a card because two names splitting a 315px box get
 * 123px each and the long ones have to be shrunk; hanging them off opposite
 * corners buys each the full width. None of that reasoning applies here.
 * This is the head of a panel, not an object in a grid, and the two clubs
 * should read as facing each other on one line.
 *
 * It also stops being a card in the other sense: no border, no radius, no
 * lean. It bleeds to the panel's edges and the art dissolves into the
 * background, so there is no edge for a corner to round.
 *
 * What it does still share is Wash and Badge, deliberately. Those are the
 * primitives for "a team's colour" and "a team's mark", not card parts, and
 * Badge in particular carries the inverted-crest fallback that a second
 * copy would get wrong.
 */
export function Matchup({ game }: { game: Game }) {
  const { home, away } = game;
  const lost = loser(game);
  // In line, the two names share one row instead of owning a whole one
  // each, so the long pairings are much tighter than on any card:
  // "Golden Knights" against "Diamondbacks" is the worst the five leagues
  // offer. Fitted as a group so they shrink together and stay peers.
  const homeText = home.shortName ?? home.name;
  const awayText = away.shortName ?? away.name;
  const [homeName, awayName] = useFitText<HTMLSpanElement>(homeText, awayText);

  return (
    <header className="matchup">
      <Wash side="home" team={home} lost={lost === "home"} />
      <Wash side="away" team={away} lost={lost === "away"} />
      <span className="matchup__scrim" aria-hidden />

      <div className="matchup__row">
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
      </div>
    </header>
  );
}
