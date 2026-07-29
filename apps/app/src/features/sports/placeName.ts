/**
 * The country on a racing card, short enough to fit it.
 *
 * The card gives its country one centred line at 28px, and the source
 * picks the string: "USA" is three characters and "United Arab Emirates"
 * is twenty. A long one has nowhere to go — most country names are ONE
 * WORD, so there is no space to wrap at, and the line simply runs out of
 * the card and over the schedule beside it.
 *
 * So past a length it becomes the code a broadcast would caption it with.
 * Adam's call, and the right one: NED is a thing people read, where a
 * shrunk or ellipsed NETHERLA… is a thing people notice.
 */

/**
 * The length at which the code takes over.
 *
 * MEASURED, not picked. The narrowest track the board's grid makes is
 * 315px, which leaves the name 137px. At 28px in the headline face,
 * AZERBAIJAN needs 159px, SINGAPORE 155 and AUSTRALIA 147 — all over —
 * while HUNGARY needs 130 and fits with 7px to spare. Eight is where that
 * line actually falls.
 *
 * Ten was the first instinct and it is too generous: it keeps AZERBAIJAN,
 * AUSTRALIA and SINGAPORE at full length, and all three overflow on a
 * narrow window. Eight costs three more codes and never breaks.
 */
const MAX = 8;

/**
 * Country to the three letters a broadcast captions it with.
 *
 * IOC codes, which is what motorsport uses and what a viewer has seen on a
 * timing screen — not ISO, which would say NL and SA. Only the codes that
 * can actually be reached are strictly needed, but the whole F1 set is
 * here so that moving MAX does not silently fall through to the guess
 * below.
 */
const CODES: Record<string, string> = {
  australia: "AUS",
  austria: "AUT",
  azerbaijan: "AZE",
  bahrain: "BRN",
  belgium: "BEL",
  brazil: "BRA",
  britain: "GBR",
  canada: "CAN",
  china: "CHN",
  hungary: "HUN",
  italy: "ITA",
  japan: "JPN",
  mexico: "MEX",
  monaco: "MON",
  netherlands: "NED",
  qatar: "QAT",
  "saudi arabia": "KSA",
  singapore: "SGP",
  spain: "ESP",
  "united arab emirates": "UAE",
  usa: "USA",
};

/**
 * What the card should print, given what the source sent.
 *
 * Short names come back untouched, which is most of them: fifteen of the
 * twenty-one countries F1 visits are seven characters or fewer.
 *
 * An unknown long name falls back to its first three letters, which is how
 * the IOC built most of its own codes and is right far more often than it
 * is wrong. The card keeps the full name on its tooltip either way, so
 * nothing is actually lost.
 */
export function shortPlace(place: string): string {
  const name = place.trim();
  if (name.length <= MAX) return name;
  return CODES[name.toLowerCase()] ?? name.slice(0, 3).toUpperCase();
}
