/**
 * Where the multiview tiles go, and how many of them a line can feed.
 *
 * Pure geometry and one policy rule, kept out of the component for the
 * reason hole.ts gives: the interesting cases here are arithmetic, and
 * arithmetic is worth testing without a DOM.
 *
 * See plan 013. The grid is 2, 3 or 4 tiles, chosen by the viewer (Adam:
 * "maybe we have one of the options in multiview be grid size so people can
 * decide to just watch two or 3 or 4 at a time"), with 4 as the ceiling.
 *
 * The tiles are web players now (MultiviewTile.tsx), placed by mvLayout.ts
 * since plan 017. `tileRects`, which placed four native mpv windows, went
 * with the native slot refactor in v0.9.94: nothing ever called it outside
 * its own tests.
 */

/** How many tiles. Four is the ceiling. */
export type GridSize = 2 | 3 | 4;

export const GRID_SIZES: readonly GridSize[] = [2, 3, 4];

/**
 * The grid sizes this line can actually feed.
 *
 * ONE TILE IS ONE PROVIDER CONNECTION. mpv.rs's `unload` doc calls
 * one-at-a-time the app's invariant and records that a max_connections=1
 * line outright FAILS to tune with a second stream open; multiview breaks
 * that on purpose, so the limit stops being a background fact and becomes
 * the feature's ceiling. Adam's own line is 3, which is exactly why the size
 * is a choice rather than a constant.
 *
 * CAPPED ON `max`, NOT ON WHAT IS FREE, and that is deliberate. `active`
 * includes this app's own stream at the moment it was polled, and opening
 * the grid releases that first, so subtracting it would under-offer every
 * time — a 3-connection line would read as 2 while you were watching
 * something. It can still be wrong the other way (another device holding a
 * connection), and the honest failure for that is a tile that does not tune,
 * which is visible, rather than a size we quietly refused to offer.
 *
 * NULL MEANS UNKNOWN, NOT ZERO. Stalker portals rarely publish a limit and
 * M3U has no API at all (see connections.ts), so a null offers everything:
 * refusing a feature because we could not ask is worse than letting it try.
 */
export function allowedSizes(
  conns: { max: number } | null | undefined,
): GridSize[] {
  if (!conns) return [...GRID_SIZES];
  return GRID_SIZES.filter((n) => n <= conns.max);
}

/**
 * What the notice tells you about your own line, in one sentence.
 *
 * Adam asked for the cap to be visible rather than implied ("visually note
 * their instance cap"), and the number is the whole point: "each stream uses
 * a connection" is abstract, "your line allows 3 at once" is something you
 * can act on.
 *
 * Four cases because they are four different situations, not four
 * phrasings. Unknown is not zero and a line that cannot do multiview at all
 * has to say so rather than let you find out by opening four dead tiles.
 */
export function capLine(conns: { max: number } | null | undefined): string {
  if (!conns) {
    return "Your provider doesn\u2019t report a limit, so we can\u2019t tell you how many will work.";
  }
  if (conns.max <= 1) {
    return "Your line allows 1 stream at a time, so multi-view can\u2019t run on it.";
  }
  if (conns.max >= 4) {
    return `Your line allows ${conns.max} at once, so it can fill all four tiles.`;
  }
  return `Your line allows ${conns.max} at once, so that\u2019s the most tiles you\u2019ll get.`;
}
