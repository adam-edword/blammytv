import { splitName } from "./playerName";
import type { Competitor } from "./model";

/**
 * A tennis scoreline, for the two cards that already draw a matchup.
 *
 * Adam, on the draw screen's rows: "I feel like we can just turn these into
 * our normal card format?" Right — a tennis match IS two sides and a score,
 * which is what these cards are for. It differs in exactly two places, and
 * these are those two places rather than a third card:
 *
 *   THE NAME is a person, so the card's small line takes the given name and
 *   its big line the surname, where a club card carries an abbreviation
 *   over a club name. Same two lines, same sizes.
 *
 *   THE SCORE is a LINE, not a number. 6-3 4-6 6-2 is three columns, and
 *   the loser of each individual set is dimmed inside a scoreline that
 *   otherwise belongs to whoever won the match. That per-set dimming is the
 *   detail that makes it read as tennis rather than as three numbers.
 */

/** Does this competitor score in sets? Tennis alone, so far. */
export function hasSets(team: Competitor): boolean {
  return (team.sets?.length ?? 0) > 0;
}

/**
 * Is this card a MATCH between two people rather than two clubs?
 *
 * Not "does it have sets", which was the first cut and is wrong at exactly
 * the moment it matters: a match that has not started has no line yet, so
 * an upcoming tennis card fell back to the club treatment and captioned
 * Tereza Valentova as "VAL" over "T. Valentova". Whether someone is a
 * person does not depend on whether they have started playing.
 *
 * `draw` is the honest test, because it is only ever set on a fixture
 * mapped out of a tournament's grouping. The sets are still checked so a
 * scoreline never loses its treatment if a source someday sends one
 * without a draw.
 */
export function isMatch(game: {
  draw?: string;
  home: Competitor;
  away: Competitor;
}): boolean {
  return game.draw != null || hasSets(game.home) || hasSets(game.away);
}

/** The given name, for the slot a club card puts its abbreviation in. */
export function givenName(team: Competitor): string {
  return splitName(team.name).first ?? "";
}

/** The surname, for the card's big line. */
export function surname(team: Competitor): string {
  return splitName(team.name).last;
}

/** How many set columns a match needs, which is the longer of the two
 * lines: a retirement leaves one side a set shorter. */
export function setColumns(home: Competitor, away: Competitor): number {
  return Math.max(home.sets?.length ?? 0, away.sets?.length ?? 0);
}
