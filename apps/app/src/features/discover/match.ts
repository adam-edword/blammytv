/**
 * How well a title answers a typed query.
 *
 * WHY THIS EXISTS. Search was delegated whole: the typed string went to
 * every search-capable catalog and whatever came back was the answer, in
 * the order it arrived. That is fine while the user types the way the
 * addon's index is written and useless the moment they do not — "ironman"
 * found nothing at all, because the catalogs match on the title's own
 * spacing and "Iron Man" does not contain that substring.
 *
 * The fix is not a better query. It is to BROADEN what we ask the network
 * for and NARROW it here, where we can compare against real titles instead
 * of guessing at an index we do not own.
 */

/**
 * The comparison key: lower-cased, with everything that is not a letter or
 * a digit removed.
 *
 * This is the whole trick for "ironman". Both sides collapse to the same
 * string — "Iron Man", "Iron-Man" and "ironman" are all `ironman` — so
 * spacing, punctuation and case stop being things the user has to guess.
 *
 * Accents are folded first, so "Amélie" is reachable by typing "amelie".
 */
/** NFD + strip combining marks. Spelled with escapes rather than the
 * literal range: those characters are invisible in an editor and a stray
 * paste through them is silent. */
const fold = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function key(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, "");
}

/** The query's words, for the partial-match tiers below. */
export function words(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * 0 means "not a match at all"; higher is better.
 *
 * The tiers are ordered by how much of the title the query accounts for,
 * because that is what makes "Iron Man" beat "Iron Man 2" for `ironman`
 * without a special case: the first is an exact key, the second only a
 * prefix.
 *
 * The word tiers below the key tiers are what let a query find a title it
 * does not lead: "man iron" and "dark knight" both have to work, and
 * neither is a prefix of anything.
 */
export function score(title: string, query: string): number {
  const t = key(title);
  const q = key(query);
  if (!t || !q) return 0;

  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;

  // Every typed word present in the title, each as a whole word or the
  // start of one. "dark knight" -> "The Dark Knight"; "harr pot" ->
  // "Harry Potter…", which is what typing ahead feels like.
  const tw = words(title);
  const qw = words(query);
  if (qw.length === 0) return 0;
  const hit = qw.filter((w) => tw.some((x) => x.startsWith(w))).length;
  if (hit === qw.length) return 40;
  // Most of them, for a typo in one word out of three. TWO hits minimum,
  // and that floor is load-bearing: without it a single stopword carries
  // half a two-word query, so "the matrix" scored against "The Godfather"
  // and searching anything beginning "the" returned the catalog. One word
  // in common is a coincidence, not a partial match.
  if (hit >= 2 && hit / qw.length >= 0.5) return 20;
  return 0;
}

/**
 * Sort by score, keeping the incoming order inside a tier.
 *
 * STABLE ON PURPOSE. What arrives is already interleaved across catalogs,
 * which is how the board stays a mix of sources rather than a run of
 * whatever answered first; re-sorting by score alone would undo that for
 * every item that ties, and ties are the common case. Array.prototype.sort
 * is required to be stable, so a plain comparator is enough.
 *
 * `drop` removes non-matches. Used for results from a BROADENED query,
 * where the network was deliberately asked something wider than the user
 * typed and the noise has to come back out. Never used on results for the
 * query as typed: if a catalog thinks its own answer is relevant, that is
 * its call to make, and scoring it to zero here would throw away the one
 * source that actually knows its own data.
 */
export function rank<T>(
  items: readonly T[],
  query: string,
  drop = false,
  // The title accessor, because the two things worth ranking spell it
  // differently: a VodItem carries `title`, a raw meta preview `name`.
  titleOf: (item: T) => string = (i) => (i as { title?: string }).title ?? "",
): T[] {
  const scored = items.map((item, i) => ({ item, i, s: score(titleOf(item), query) }));
  const kept = drop ? scored.filter((x) => x.s > 0) : scored;
  return kept.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.item);
}

/**
 * A wider query to fall back to, or null when there is no point.
 *
 * A prefix, because the catalogs match substrings of a title: "iron" is
 * inside "Iron Man" where "ironman" is inside nothing. Truncating is the
 * only lever that works without a dictionary of English compounds, and it
 * terminates immediately — one extra request, not a ladder.
 *
 * Four characters is the floor. Below that a prefix stops being about this
 * title and starts returning the catalog: "the" would match nearly
 * everything, and ranking a thousand items to find none is slower and
 * worse than saying there are no results.
 *
 * Only for single-word queries. A multi-word query that found nothing has
 * a different problem (wrong words, not missing spaces), and truncating
 * its last word would ask something the user never implied.
 */
export const BROADEN_FLOOR = 4;
export function broaden(query: string): string | null {
  const q = query.trim();
  if (words(q).length !== 1) return null;
  const k = key(q);
  if (k.length <= BROADEN_FLOOR) return null;
  // THE FLOOR ITSELF, not a fraction of the word. A proportional cut was
  // the first attempt and it does not work: "darkknight" at two thirds is
  // "darkkn", which still spans the space in "Dark Knight" and matches
  // nothing. The prefix has to stop before the seam, and the seam can be
  // anywhere, so the only cut that survives the common cases is the
  // shortest one that is still specific.
  //
  // Known limit, and it is inherent rather than an oversight: this can
  // only find compounds whose FIRST part is at least four characters.
  // "adastra" stays unfindable, because "adas" spans the seam too. Fixing
  // that needs a dictionary of English compounds, which is a much bigger
  // thing than the bug being fixed here.
  return k.slice(0, BROADEN_FLOOR);
}
