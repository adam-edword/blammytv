/**
 * Where the multiview tiles go, and how many of them a line can feed.
 *
 * Pure geometry and one policy rule, kept out of the component for the
 * reason hole.ts gives: the interesting cases here are arithmetic, and
 * arithmetic is worth testing without a DOM.
 *
 * See plan 013. The grid is 2, 3 or 4 tiles, chosen by the viewer (Adam:
 * "maybe we have one of the options in multiview be grid size so people can
 * decide to just watch two or 3 or 4 at a time"), with 4 as the ceiling the
 * Rust side is built for.
 */

/** A rect in the same PHYSICAL px the player driver pushes to inv_set_rect. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How many tiles. Four is the ceiling: mpv::SLOTS is 4. */
export type GridSize = 2 | 3 | 4;

export const GRID_SIZES: readonly GridSize[] = [2, 3, 4];

/**
 * The tiles, in slot order, for a grid of `count` inside `box`.
 *
 * `gap` is the space BETWEEN tiles and nothing else: the grid fills the box
 * exactly, with no outer padding, so the tiles land where the clip holes are
 * cut and there is no border of stale webview showing through.
 *
 * THE 3-UP IS ONE BIG PLUS TWO SMALL, not three in a row, and the arithmetic
 * decides it rather than taste. In a 16:9 box, three in a row gives each
 * tile a 5.33:9 cell that a 16:9 picture fits to width, so each video is
 * 5.33x3 and the total picture is 48 units². One big (two thirds wide) plus
 * two stacked gives 10.67x6 and two 5.33x3, which is 96 — twice the video
 * for the same box. It also matches what three games usually means: one you
 * are watching and two you are keeping an eye on, which is the same shape as
 * the focused slot the player already has.
 */
export function tileRects(box: Box, count: GridSize, gap: number): Box[] {
  const { x, y, w, h } = box;
  // A gap wider than the box would invert the tiles. Clamp rather than
  // guard the callers: this runs off measured layout, and a collapsed box
  // during a transition is normal rather than exceptional.
  const g = Math.max(0, Math.min(gap, w / 2, h / 2));
  const halfW = (w - g) / 2;
  const halfH = (h - g) / 2;
  if (count === 2) {
    // Side by side. Stacking wastes exactly the same picture area (both put
    // an 8x4.5 video in a half-box), so this is the conventional 2-up rather
    // than a measured win.
    return [
      { x, y, w: halfW, h },
      { x: x + halfW + g, y, w: halfW, h },
    ];
  }
  if (count === 3) {
    const bigW = (w - g) * (2 / 3);
    const sideW = w - g - bigW;
    return [
      { x, y, w: bigW, h },
      { x: x + bigW + g, y, w: sideW, h: halfH },
      { x: x + bigW + g, y: y + halfH + g, w: sideW, h: halfH },
    ];
  }
  return [
    { x, y, w: halfW, h: halfH },
    { x: x + halfW + g, y, w: halfW, h: halfH },
    { x, y: y + halfH + g, w: halfW, h: halfH },
    { x: x + halfW + g, y: y + halfH + g, w: halfW, h: halfH },
  ];
}

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
    return `Your line allows ${conns.max} at once, so any size works.`;
  }
  return `Your line allows ${conns.max} at once, so that\u2019s the biggest grid you\u2019ll get.`;
}

/**
 * The size to actually open at, given what the viewer picked last.
 *
 * Clamps down to what the line allows rather than refusing: someone who
 * chose 4 on one playlist and switched to a 3-connection one gets 3, which
 * is what they meant. Null when the line cannot do multiview at all.
 */
export function usableSize(
  want: GridSize,
  conns: { max: number } | null | undefined,
): GridSize | null {
  const allowed = allowedSizes(conns);
  if (allowed.length === 0) return null;
  return allowed.includes(want) ? want : allowed[allowed.length - 1];
}
