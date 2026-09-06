import { load, save } from "../../lib/storage";

/**
 * Opt-in (default OFF): a college game only stays on the board if either
 * side is in the top 25.
 *
 * PERSISTED, unlike the board's league picks, and the split is the same one
 * SportsScreen already draws: a pick is what you are looking at right now,
 * a follow is what you keep. This is a standing preference about college
 * sport, so it keeps.
 *
 * It sits beside the conference follows rather than inside them because it
 * INTERSECTS where they union. Following the SEC and the Big Ten means
 * either; ranked means both this and that. One array cannot hold two
 * different operators.
 *
 * Scoped to games a poll has an opinion about — see `isRankable`. Applied
 * to everything it would hide every professional game forever.
 */

const KEY = "sportsRankedOnly";
const VERSION = 1;

export function loadRankedOnly(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveRankedOnly(on: boolean): void {
  save(KEY, VERSION, on);
}
