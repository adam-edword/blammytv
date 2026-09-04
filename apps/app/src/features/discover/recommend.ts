/**
 * The REC chip's request channel.
 *
 * Same shape and the same reason as typeFilter's request half: the header
 * can press this while DiscoverScreen is unmounted (you can be on the
 * Guide), and App holds the screen swap back by NAV_SETTLE_MS on top of
 * that, so a bare event would land in an empty room. A flag waits to be
 * collected instead.
 *
 * There is no `publish` twin. The type filter needs one because the header
 * RENDERS the current filter, so it has to know what Discover settled on.
 * The REC chip renders the same whether the page is open or not, so a
 * published value would be state nobody reads.
 */

const REQUEST = "blammytv:recommend-request";

let wanted = false;

/** Ask for the recommender. */
export function requestRecommend(): void {
  wanted = true;
  window.dispatchEvent(new CustomEvent(REQUEST));
}

/** Collect the request, once. */
export function takeRecommendRequest(): boolean {
  const had = wanted;
  wanted = false;
  return had;
}

export function onRecommendRequest(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(REQUEST, h);
  return () => window.removeEventListener(REQUEST, h);
}

/** A tab flip unmounts DiscoverScreen, so a request it never drained must
 * not fire at whatever mounts next. */
export function resetRecommend(): void {
  wanted = false;
}
