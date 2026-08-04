/**
 * A player's name, split the way a scoreboard sets it: "Alex" over
 * "Michelsen".
 *
 * Its own module for the reason day.ts and nameList.ts are: it has a right
 * answer, and a component file that also exports a helper cannot be
 * hot-swapped.
 *
 * The SURNAME is the big line, which is not a style choice — it is what a
 * broadcast captions with and what anyone following a match actually reads.
 * The given name goes in the slot a club card uses for its abbreviation, so
 * a tennis card and a football card are the same object with the same two
 * lines rather than two layouts that happen to look alike.
 */
export interface PlayerName {
  /** "Alex". Absent where splitting would be a guess. */
  first?: string;
  /** "Michelsen", or the whole thing where there is nothing to split. */
  last: string;
}

export function splitName(full: string): PlayerName {
  const name = full.trim();
  if (!name) return { last: "" };
  /**
   * A DOUBLES PAIR is not a person and must not be cut up. They arrive as
   * "Bopanna/Ebden" off the roster rather than an athlete, and taking the
   * last word of that would caption the card with half a team. 37 of 175
   * matches on a real board are doubles, so this is the common case, not an
   * edge one.
   */
  if (name.includes("/")) return { last: name };
  const cut = name.lastIndexOf(" ");
  if (cut <= 0) return { last: name };
  return { first: name.slice(0, cut), last: name.slice(cut + 1) };
}
