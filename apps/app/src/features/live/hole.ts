/** One rounded-rect cutout, wound COUNTER-CLOCKWISE.
 *
 * Split out because the grid needs several of them in one path and the
 * winding is the whole trick: with the outer rect clockwise and every inner
 * subpath counter-clockwise, the default nonzero fill-rule leaves a hole
 * under each, with no dependency on evenodd support. */
const cutout = (
  l: number,
  t: number,
  r: number,
  b: number,
  rad: number,
): string => {
  const k = Math.min(rad, (r - l) / 2, (b - t) / 2);
  return k > 0
    ? `M${l + k} ${t}A${k} ${k} 0 0 0 ${l} ${t + k}L${l} ${b - k}` +
        `A${k} ${k} 0 0 0 ${l + k} ${b}L${r - k} ${b}` +
        `A${k} ${k} 0 0 0 ${r} ${b - k}L${r} ${t + k}` +
        `A${k} ${k} 0 0 0 ${r - k} ${t}Z`
    : `M${l} ${t}L${l} ${b}L${r} ${b}L${r} ${t}Z`;
};

/** Full-viewport ring with a ROUNDED-rect cutout at CSS-px rect (l,t,r,b).
 * clip-path path(): the outer rect winds clockwise and the inner rounded
 * rect counter-clockwise, so the default nonzero fill-rule leaves a hole —
 * no dependency on evenodd support. Coords are plain px; the outer rect
 * needs the window size, so callers key on it too. (Extracted from
 * InvertedPlayer for testability.) */
export const holeClip = (
  l: number,
  t: number,
  r: number,
  b: number,
  rad: number,
  W: number,
  H: number,
): string => `path("M0 0H${W}V${H}H0Z ${cutout(l, t, r, b, rad)}")`;

/** One ring with SEVERAL cutouts: the multiview grid, where each tile is its
 * own child window and so needs its own hole.
 *
 * Same winding rule, applied N times. Nonzero counts crossings rather than
 * pairing them, so tiles that touch or overlap still read as one continuous
 * opening instead of cancelling back to opaque — which is what evenodd would
 * have done, and is why the fill-rule choice above is load-bearing rather
 * than incidental.
 *
 * An empty list is a ring with no holes, which is the correct clip for a
 * grid that has not opened yet. */
export const holesClip = (
  rects: readonly { l: number; t: number; r: number; b: number }[],
  rad: number,
  W: number,
  H: number,
): string =>
  `path("M0 0H${W}V${H}H0Z${rects
    .map((c) => ` ${cutout(c.l, c.t, c.r, c.b, rad)}`)
    .join("")}")`;

/** The frost region under a modal card, video-normalized against the slot
 * rect and clamped to [0,1]. Null = card doesn't overlap the video.
 * (Mirrors LiveScreen's modal-frost math; extracted for testability.) */
export function frostRegion(
  slot: { left: number; top: number; width: number; height: number },
  card: { left: number; top: number; right: number; bottom: number },
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (slot.width <= 0 || slot.height <= 0) return null;
  const x0 = Math.max(0, (card.left - slot.left) / slot.width);
  const y0 = Math.max(0, (card.top - slot.top) / slot.height);
  const x1 = Math.min(1, (card.right - slot.left) / slot.width);
  const y1 = Math.min(1, (card.bottom - slot.top) / slot.height);
  return x1 <= x0 || y1 <= y0 ? null : { x0, y0, x1, y1 };
}
