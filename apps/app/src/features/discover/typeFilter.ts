/**
 * Discover's type filter, shared with the header.
 *
 * WHY THIS IS NOT JUST A STORE. The filter is a HISTORY ENTRY: picking a
 * type is a page change in DiscoverScreen, so it lives in that screen's
 * view stack and Back can change it without anyone clicking a chip. If the
 * header owned the value there would be two truths and Back would desync
 * them.
 *
 * So the traffic runs in both directions with one owner:
 *
 *   publish()  DiscoverScreen says what the filter IS, whenever its view
 *              changes — including from Back and Forward.
 *   request()  the header says what it should BECOME. DiscoverScreen turns
 *              that into a real navigate(), which is what puts it in the
 *              history stack.
 *
 * The header renders from the published value and never assigns to it. Same
 * mailbox shape as openRequest and the search focus request, for the same
 * reason: the sender cannot reach the state, and the receiver may not be
 * mounted yet.
 */

export type TypeFilter = "all" | "movie" | "series";

const CHANGE = "blammytv:discover-filter";
const REQUEST = "blammytv:discover-filter-request";

let current: TypeFilter = "all";
let wanted: TypeFilter | null = null;

/** What Discover is actually showing. */
export const getTypeFilter = (): TypeFilter => current;

/** DiscoverScreen only: announce the committed filter. */
export function publishTypeFilter(f: TypeFilter): void {
  if (f === current) return;
  current = f;
  window.dispatchEvent(new CustomEvent(CHANGE));
}

export function onTypeFilterChange(cb: (f: TypeFilter) => void): () => void {
  const h = () => cb(current);
  window.addEventListener(CHANGE, h);
  return () => window.removeEventListener(CHANGE, h);
}

/**
 * Ask for a filter. Held as well as dispatched: the header can fire this
 * while DiscoverScreen is unmounted (you can be on the Guide), and App
 * holds the screen swap back by NAV_SETTLE_MS on top of that, so a bare
 * event would land in an empty room.
 */
export function requestTypeFilter(f: TypeFilter): void {
  wanted = f;
  window.dispatchEvent(new CustomEvent(REQUEST));
}

/** Collect the request, once. */
export function takeTypeFilterRequest(): TypeFilter | null {
  const had = wanted;
  wanted = null;
  return had;
}

export function onTypeFilterRequest(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(REQUEST, h);
  return () => window.removeEventListener(REQUEST, h);
}

/** A tab flip unmounts DiscoverScreen; the next mount seeds from its own
 * session, so the header's copy must not outlive it as a claim about
 * something on screen. */
export function resetTypeFilter(f: TypeFilter): void {
  current = f;
  wanted = null;
  window.dispatchEvent(new CustomEvent(CHANGE));
}
