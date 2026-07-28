import { memo } from "react";
import { Badge } from "./Badge";
import { Wash } from "./Wash";
import { loser } from "./result";
import type { Game } from "./model";

/**
 * A finished game as one line (plan 010).
 *
 * By the evening a day is mostly results, and fifteen full cards for games
 * already played bury the two still to come. This says the same thing in a
 * quarter of the height: who played, and what it finished.
 *
 * Abbreviations rather than names, because the crest is right beside them
 * and "CHC" next to the Cubs' mark is not ambiguous at this size. The
 * beaten side keeps the light weight it has on the full card, so a column
 * of these still reads for who won without reading a number.
 *
 * NO LEAGUE TAG, unlike either full card. It is the one thing on the line
 * whose width is not bounded by the sport: "MLB" is three characters and
 * "Premier League" is fourteen, with FIFA's competition names longer
 * still. Measured, it took 117.5px of a 344px row and pushed the scoreline
 * out of its own column and under the crest beside it. It is also the
 * least load-bearing thing here, since every mark on the line already says
 * which sport this is.
 *
 * No tilt and no glare: those are for something you are choosing between,
 * and this is a record of something that already happened. It also keeps a
 * long column of them cheap.
 */
function CompactCardImpl({
  game,
  onOpen,
}: {
  game: Game;
  onOpen?: (game: Game) => void;
}) {
  const { home, away } = game;
  const lost = loser(game);
  return (
    <button
      type="button"
      className="compactcard"
      title={`${home.name} vs ${away.name}`}
      onClick={() => onOpen?.(game)}
    >
      <Wash side="home" team={home} lost={lost === "home"} />
      <Wash side="away" team={away} lost={lost === "away"} />
      <span className="compactcard__scrim" aria-hidden />

      <span className="compactcard__status">{game.status}</span>

      <span className="compactcard__game">
        {/* Mark and tag are one thing, so they sit together and the gaps
          * that matter are the ones between the three groups. */}
        <span className="compactcard__side compactcard__side--home">
          <Badge team={home} />
          <span
            className={
              "compactcard__abbr" + (lost === "home" ? " is-lost" : "")
            }
          >
            {home.abbr}
          </span>
        </span>
        <span className="compactcard__score">
          <span className={lost === "home" ? "is-lost" : undefined}>
            {home.score ?? 0}
          </span>
          <span className="compactcard__dash" aria-hidden>
            -
          </span>
          <span className={lost === "away" ? "is-lost" : undefined}>
            {away.score ?? 0}
          </span>
        </span>
        <span className="compactcard__side compactcard__side--away">
          <span
            className={
              "compactcard__abbr" + (lost === "away" ? " is-lost" : "")
            }
          >
            {away.abbr}
          </span>
          <Badge team={away} />
        </span>
      </span>
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
export const CompactCard = memo(CompactCardImpl);
