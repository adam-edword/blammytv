/**
 * The search query, and the request to focus the field.
 *
 * The query outlived its original reason to be here: the input used to sit
 * in the header while the results rendered in Discover. Both live in
 * Discover now, but the store stays — DiscoverScreen unmounts every time
 * you leave the tab, and the query has to survive that.
 *
 * The focus request is a MAILBOX rather than a plain event, and that is
 * load-bearing. `/`, Ctrl+K and Ctrl+F are handled app-wide, so they can
 * fire while Discover is not even mounted; App holds the screen swap back
 * by NAV_SETTLE_MS on top of that. A dispatched event would land in an
 * empty room. A flag waits to be collected instead, and DiscoverScreen
 * drains it on mount as well as listening while it is up.
 */

let value = "";
const EVENT = "blammytv:search-query";

export const getSearchQuery = (): string => value;

export function setSearchQuery(q: string): void {
  if (q === value) return;
  value = q;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onSearchQueryChange(cb: (q: string) => void): () => void {
  const h = () => cb(value);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/* ---------------------------------------------------------------- focus */

const FOCUS_EVENT = "blammytv:search-focus";
let wanted = false;

/** Ask for the search field, wherever and whenever it turns up. */
export function requestSearchFocus(): void {
  wanted = true;
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
}

/** Collect the request, once. Returns false if there was none. */
export function takeSearchFocus(): boolean {
  const had = wanted;
  wanted = false;
  return had;
}

export function onSearchFocusRequest(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(FOCUS_EVENT, h);
  return () => window.removeEventListener(FOCUS_EVENT, h);
}
