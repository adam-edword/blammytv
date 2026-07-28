import type { Match } from "./matcher";
import type { Game } from "./model";

/**
 * Should the theater put this game on by itself, and with what?
 *
 * Opening a card plays the game. No modal, no picking a source first: the
 * question "which feed" only matters when the first one fails, and making
 * everybody answer it every time to serve that case is the wrong trade.
 * The rail is still right there for anyone who wants a different one.
 *
 * A pure function rather than four conditions buried in an effect, because
 * every one of them is a rule about when NOT to play and those are the
 * cases worth writing down and testing. The caller owns `armedFor`; this
 * only reads it.
 */
export function autoPlay(
  game: Pick<Game, "id" | "state">,
  /** The theater's rail, in the order it is drawn. */
  matches: Match[],
  /** The game this has already fired for, or null. */
  armedFor: string | null,
): Match | null {
  // Once per game. This is what stops autoplay fighting the user: closing
  // the player with the overlay leaves it closed instead of being restarted
  // a frame later, and a row picked by hand is never overridden.
  if (armedFor === game.id) return null;
  // "Put the game on" means nothing for a game that finished hours ago. Its
  // networks moved on to something else, and that something else is not
  // what the click asked for.
  if (game.state === "final") return null;
  // Nothing matched, or the catalog has not loaded yet. The caller re-asks
  // when the channels arrive, which is why "not yet" and "never" can share
  // an answer here.
  //
  // The BEST source is not a new judgement invented here: it is the top of
  // the rail, the same row the eye lands on. If that order is ever wrong it
  // is wrong on screen too, which makes it an ordering question rather than
  // an autoplay one.
  return matches[0] ?? null;
}
