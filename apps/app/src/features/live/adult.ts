import type { XtreamCategory } from "../../data/xtream";
import type { XtreamStream } from "../../data/xtream";

/**
 * Adult-content detection for the hide-by-default filter. Two signals:
 * the panel's own `is_adult` flag (authoritative when present), and a
 * CONSERVATIVE name pattern for panels that don't send it. Conservative
 * means word-boundary matches on unambiguous terms only — a false positive
 * hides real content behind a setting most users never open, which is worse
 * than a miss. Category names only; matching 20k channel *names* would be
 * false-positive soup.
 */

/** Unambiguous adult markers, word-bounded ("XXX" yes, "XXXL" no). "18+"
 * gets only a leading boundary — \b can't sit after "+" (a non-word char),
 * and the leading one already rejects "U18+" / "2018+". */
const NAME_PATTERN = /\b(?:xxx|porno?|adults?|erotic[as]?)\b|\b18\+/i;

/** "Adult Swim" is Cartoon Network's late-night block — the classic false
 * positive for \badult\b. */
const EXCEPTIONS = /adult\s*swim/i;

/** Conservative name-only check, for surfaces that lack the panel flag. */
export function nameLooksAdult(name: string): boolean {
  return NAME_PATTERN.test(name) && !EXCEPTIONS.test(name);
}

/** A category is adult when the panel flags it OR its name says so. */
export function isAdultCategory(c: XtreamCategory): boolean {
  return c.adult || nameLooksAdult(c.name);
}

/** Stream-level panel flag (some panels mark individual streams instead of
 * — or as well as — their category). String-typed as often as not. */
export function isAdultStream(s: XtreamStream): boolean {
  return Number(s.is_adult) === 1;
}
