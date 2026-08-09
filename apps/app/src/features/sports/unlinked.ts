import type { Game } from "./model";

/**
 * Why the WHOLE board is unlinked, or null if it is not (plan 010 #21).
 *
 * The cards already say "Couldn't link" one at a time, which is the right
 * answer per game and the wrong one when it is true of every game on screen:
 * at that point the cause is the setup rather than this fixture, and
 * repeating it twenty times says so twenty times without ever saying it once.
 *
 * Its own module rather than a helper inside SportsScreen, because the
 * interesting part is which cases must NOT fire and those are impossible to
 * reach by hand: a board of finals, a board mid-resolve, a board where one
 * single game matched. Testing them means importing this, and importing
 * SportsScreen drags the component tree and a DOM in behind it.
 */
export function unlinkedReason(
  games: readonly Game[],
  catalogSize: number,
): "no-playlist" | "unmatched" | null {
  // Games you could actually WATCH. A finished game's carriage line is its
  // start time rather than a channel, so counting finals would fire this on
  // any evening whose board had already played out.
  const watchable = games.filter((g) => g.state !== "final");
  if (watchable.length === 0) return null;
  // `channelsPending` is the difference between "not on your channels" and
  // "not known yet". Announcing the first while the second is true is the
  // flash useCatalog's warm start exists to avoid.
  if (watchable.some((g) => g.channelsPending)) return null;
  if (watchable.some((g) => g.channels.length > 0)) return null;
  // Two different problems wearing one symptom, and the fix for either is no
  // use for the other.
  return catalogSize > 0 ? "unmatched" : "no-playlist";
}
