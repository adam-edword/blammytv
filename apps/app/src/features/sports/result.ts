import type { Side } from "./Wash";
import type { Fixture } from "./model";

/**
 * Which side lost, once there is such a thing.
 *
 * Only when it is over: a team trailing in the third is not losing, it is
 * behind, and draining the colour out of them mid-game would both be a lie
 * and flicker every time the score moved. A draw has no loser either,
 * which soccer needs and the others never hit.
 *
 * Its own module because both cards ask, and because a component file that
 * exports a helper as well as a component cannot be hot-swapped on its own
 * (React Fast Refresh, the same reason lib/reducedMotion.ts exists).
 *
 * A FIXTURE, not a Game. An ordered field has no side to lose: a race has
 * a winner and twenty-one people who are not, which is a different
 * question and one the race card answers with the order itself.
 */
export function loser(game: Fixture): Side | undefined {
  if (game.state !== "final") return undefined;
  const h = game.home.score;
  const a = game.away.score;
  if (h === undefined || a === undefined || h === a) return undefined;
  return h < a ? "home" : "away";
}
