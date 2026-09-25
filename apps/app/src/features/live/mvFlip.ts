/**
 * FLIP's arithmetic for multi-view's motion (mvMotion.ts), apart from the
 * DOM so it can be tested here, where there is none.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * FLIP's invert: the transform that draws an element laid out at `last`
 * where it was (`first`), about its top-left corner. Null when it has not
 * moved. `scale` false for a caption, which moves but keeps its size.
 */
export function invert(first: Box, last: Box, scale: boolean): string | null {
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const s = scale && last.width > 0 ? first.width / last.width : 1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(s - 1) < 0.002) return null;
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}
