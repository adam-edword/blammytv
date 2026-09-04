/**
 * The REC chip's request channel.
 *
 * Same shape and the same reason as typeFilter's request half: the header
 * can press this while DiscoverScreen is unmounted (you can be on the
 * Guide), and App holds the screen swap back by NAV_SETTLE_MS on top of
 * that, so a bare event would land in an empty room. A flag waits to be
 * collected instead.
 *
 * IT HAS A `publish` TWIN NOW, and the comment here used to say it did not
 * need one: "the REC chip renders the same whether the page is open or
 * not". That stopped being true the moment the chip joined the thumb rail.
 * The thumb sits on whatever you are looking at, and the label only opens
 * under it, so the header has to know whether the page is open — including
 * when Back is what closed it, which the chip never hears about.
 *
 * Same two directions as typeFilter, and the same single owner:
 *
 *   publish()  DiscoverScreen says whether the page IS open, whenever its
 *              view changes, Back and Forward included.
 *   request()  the header says it should open. DiscoverScreen turns that
 *              into a navigate(), which is what puts it in history.
 */

const REQUEST = "blammytv:recommend-request";
const CHANGE = "blammytv:recommend-open";

let wanted = false;
let open = false;

/** Whether the recommender is the page on screen. */
export const isRecommendOpen = (): boolean => open;

/** DiscoverScreen only: announce the committed view. */
export function publishRecommend(v: boolean): void {
  if (v === open) return;
  open = v;
  window.dispatchEvent(new CustomEvent(CHANGE));
}

export function onRecommendChange(cb: (open: boolean) => void): () => void {
  const h = () => cb(open);
  window.addEventListener(CHANGE, h);
  return () => window.removeEventListener(CHANGE, h);
}

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
  // The header's copy must not outlive the screen it describes.
  publishRecommend(false);
}
