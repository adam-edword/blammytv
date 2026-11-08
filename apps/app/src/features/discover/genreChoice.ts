/**
 * Discover's genre, shared with Classic's "Show:" dropdown.
 *
 * The same two-way shape as typeFilter.ts and for the same reason: the genre
 * is a HISTORY ENTRY in DiscoverScreen's view stack (Back can change it), so
 * the header never owns it.
 *
 *   publish()  DiscoverScreen says which genres there are and which is picked,
 *              Back and Forward included.
 *   request()  the dropdown says which it should BECOME. DiscoverScreen turns
 *              that into a navigate(), which is what puts it in history.
 *
 * Only Classic's band reads this. Default's genre rail is on the page and
 * needs nothing from the header.
 */

export interface GenreChoice {
  genres: readonly string[];
  /** The picked genre, as the rail spells it; null is every genre. */
  current: string | null;
}

const CHANGE = "blammytv:discover-genre";
const REQUEST = "blammytv:discover-genre-request";
const NONE: GenreChoice = { genres: [], current: null };

let choice: GenreChoice = NONE;
let wanted: { genre: string | null } | null = null;

export const getGenreChoice = (): GenreChoice => choice;

/** DiscoverScreen only: announce the genres and the committed pick. */
export function publishGenreChoice(next: GenreChoice): void {
  if (next.current === choice.current && next.genres === choice.genres) return;
  choice = next;
  window.dispatchEvent(new CustomEvent(CHANGE));
}

/** A tab flip unmounts DiscoverScreen: the band must not keep its genres. */
export function resetGenreChoice(): void {
  wanted = null;
  publishGenreChoice(NONE);
}

export function onGenreChoiceChange(cb: () => void): () => void {
  window.addEventListener(CHANGE, cb);
  return () => window.removeEventListener(CHANGE, cb);
}

/** Ask for a genre, or null for every genre. */
export function requestGenreChoice(genre: string | null): void {
  wanted = { genre };
  window.dispatchEvent(new CustomEvent(REQUEST));
}

/** Collect the request, once. */
export function takeGenreChoiceRequest(): { genre: string | null } | null {
  const had = wanted;
  wanted = null;
  return had;
}

export function onGenreChoiceRequest(cb: () => void): () => void {
  window.addEventListener(REQUEST, cb);
  return () => window.removeEventListener(REQUEST, cb);
}
