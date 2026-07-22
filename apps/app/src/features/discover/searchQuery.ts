/**
 * The search query lives OUTSIDE DiscoverScreen because the input lives
 * in the header (AppHeader) while the results render in Discover — a
 * tiny shared store, same event pattern as the settings stores.
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
