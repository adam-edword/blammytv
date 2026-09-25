import type { SyntheticEvent } from "react";

/**
 * onLoad for artwork that fades in (the `.art-in` rule, base.css), instead
 * of painting in top-down as its bytes arrive.
 *
 * Marks the <img> once it is DECODED, not just fetched: these are big and
 * `decoding="async"`, so the load event can fire a frame or two before
 * there are pixels, and a fade started then runs over nothing and pops.
 * The attribute is set on the element rather than through state because
 * nothing else needs to re-render for it; give the <img> a `key` of its
 * src so a new picture is a new element and fades in again.
 */
export function artLoaded(e: SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget;
  const show = () => img.setAttribute("data-loaded", "");
  img.decode().then(show, show);
}
