/**
 * Where the Stream tab's home grid was scrolled to, held for the life of
 * the app process.
 *
 * Leaving the tab unmounts StreamScreen (App renders one tab at a time), so
 * coming back put you at the top of the rows every time. Unlike Discover,
 * nothing else needs saving: the catalog itself survives in source.ts's
 * module cache, so the rows repaint instantly on remount.
 *
 * Deliberately NOT the view. The tab pills are top-level navigation, and a
 * pill that drops you back inside a show instead of on the tab it names
 * reads as stuck. Re-entry always lands on home, with home where you left
 * it.
 */

let held: { key: string; scroll: number } | null = null;

export function saveStreamScroll(key: string, scroll: number): void {
  held = { key, scroll };
}

/** The offset, if it belongs to the catalog that is configured now. */
export function readStreamScroll(key: string): number {
  return held && held.key === key ? held.scroll : 0;
}
