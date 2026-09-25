/**
 * Where multi-view's tiles go (plan 017, "Layouts").
 *
 * Every picture is exactly 16:9 and sized to the stage, with a caption row
 * under it for the name, and the whole group is centred. Black only between
 * tiles, never inside one: that was the complaint about the CSS grid this
 * replaces, which split the stage into 1fr cells and letterboxed a picture
 * somewhere inside each.
 *
 * Pure arithmetic, no DOM, for the reason multiview.ts gives: the cases
 * worth testing are numbers. Prototyped in the design mockups first
 * (frames F and G), where the same two functions drew the pictures.
 *
 * Two families, the ones every shipping product has:
 * - GRID: equal tiles. 2 side by side, 3 as two over one, 4 as 2x2.
 * - FOCUS: one big tile and the rest stacked on its right. 013 measured the
 *   3-up this way: in a 16:9 window it is twice the picture of three in a row.
 */

export type MvKind = "grid" | "focus";

/** A rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MvLayout {
  /** The PICTURE of each cell, in order. Its caption sits directly under
   * it, `caption` pixels tall, inside the same column. */
  tiles: Rect[];
  /** Focus only: the split it was laid out at (the big tile's share of the
   * pictures' combined width), after clamping. */
  split?: number;
  /** Focus only: the gap between the big tile and the stack, where the
   * seam a drag grabs sits (P4b). */
  seam?: { x: number; top: number; bottom: number };
}

export interface MvSpacing {
  /** Between tiles, both ways. */
  gap: number;
  /** The caption row under every picture. */
  caption: number;
}

/** A 14px gap and a 30px caption row, the numbers frame G was drawn with. */
export const MV_SPACING: MvSpacing = { gap: 14, caption: 30 };

const R = 16 / 9;

/** The layouts a cell count can take. One cell is only ever itself. */
export function kindsFor(n: number): MvKind[] {
  return n >= 2 ? ["grid", "focus"] : ["grid"];
}

/**
 * The layout a count opens in, before anyone picks: 013's measured calls.
 * Three is one big plus two; two and four are equal.
 */
export function defaultKind(n: number): MvKind {
  return n === 3 ? "focus" : "grid";
}

export function mvLayout(
  kind: MvKind,
  n: number,
  box: Rect,
  sp: MvSpacing,
  split?: number,
): MvLayout {
  if (n <= 0) return { tiles: [] };
  if (kind === "focus" && n >= 2) return focus(n - 1, box, sp, split);
  return grid(n, box, sp);
}

/** Positions laid out from 0,0, moved so the group sits in the middle. */
function centre(rects: Rect[], gw: number, gh: number, box: Rect): Rect[] {
  const ox = box.x + (box.w - gw) / 2;
  const oy = box.y + (box.h - gh) / 2;
  return rects.map((r) => ({ x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }));
}

function grid(n: number, box: Rect, { gap: g, caption: c }: MvSpacing): MvLayout {
  const cols = n === 1 ? 1 : 2;
  const rows = n <= 2 ? 1 : 2;
  // The widest picture that fits both ways: across, the columns and their
  // gaps; down, the rows with their captions and gaps.
  const w = Math.max(
    0,
    Math.min(
      (box.w - (cols - 1) * g) / cols,
      ((box.h - (rows - 1) * g) / rows - c) * R,
    ),
  );
  const h = w / R;
  const cell = (col: number, row: number): Rect => ({
    x: col * (w + g),
    y: row * (h + c + g),
    w,
    h,
  });
  const rects =
    n === 1
      ? [cell(0, 0)]
      : n === 2
        ? [cell(0, 0), cell(1, 0)]
        : n === 3
          ? // Two over one, the one centred under the pair.
            [cell(0, 0), cell(1, 0), { ...cell(0, 1), x: (w + g) / 2 }]
          : [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)];
  const gw = cols * w + (cols - 1) * g;
  const gh = rows * (h + c) + (rows - 1) * g;
  return { tiles: centre(rects, gw, gh, box) };
}

/**
 * The fits Focus is built from, for k small tiles beside the big one.
 *
 * `bwFit` is the widest big tile whose picture and caption fit the stage's
 * height, `swFit` the widest small tile whose stack does, and `across` is
 * the pictures' combined width with the group spanning the stage.
 */
function fits(k: number, box: Rect, { gap: g, caption: c }: MvSpacing) {
  return {
    bwFit: Math.max(0, (box.h - c) * R),
    swFit: Math.max(0, ((box.h - (k - 1) * g) / k - c) * R),
    across: Math.max(0, box.w - g),
  };
}

/**
 * The NATURAL split: the big tile exactly as tall as the stack, so the two
 * columns line up top and bottom. What Focus opens at, and where a
 * double-click on the seam goes back to.
 *
 * Two regimes. On a wide, short stage both columns hit the height first:
 * each is as tall as the stage and the group is narrower than it. Otherwise
 * the group spans the stage and the split solves
 *
 *   bw/R + c = k * (sw/R + c) + (k-1) * g,   bw + sw = across
 *
 * for the big tile's share. With no captions or gaps that is k/(k+1)
 * exactly; they push it a little further towards the big tile, because the
 * stack pays for its captions and gaps k times and the big tile once.
 */
export function naturalSplit(n: number, box: Rect, sp: MvSpacing): number {
  const k = n - 1;
  if (k < 1) return 1;
  const { bwFit, swFit, across } = fits(k, box, sp);
  if (bwFit + swFit <= across) return bwFit + swFit > 0 ? bwFit / (bwFit + swFit) : 0.5;
  if (across <= 0) return k / (k + 1);
  return k / (k + 1) + ((k - 1) * (sp.caption + sp.gap) * R) / ((k + 1) * across);
}

/**
 * How far the split can go, as [smallest, largest] big-tile share.
 *
 * The big tile never gets narrower than half the pictures' width, nor so
 * narrow that the stack outgrows the stage's height; the small tiles never
 * get narrower than a fifth of the stage, nor the big one so wide that it
 * does. The natural split is always inside the range, even where the fifth
 * would exclude it (four tiles in a small window), because the layout Focus
 * opens at has to be one you can get back to.
 *
 * On a stage where the natural split is height-limited there is no room to
 * move at all: making either side bigger would make it taller than the
 * stage. The range collapses to the natural split, and the seam stays put.
 */
export function splitRange(n: number, box: Rect, sp: MvSpacing): [number, number] {
  const nat = naturalSplit(n, box, sp);
  const k = n - 1;
  if (k < 1) return [nat, nat];
  const { bwFit, swFit, across } = fits(k, box, sp);
  if (across <= 0) return [nat, nat];
  const lo = Math.max(0.5, 1 - swFit / across);
  const hi = Math.min(1 - box.w / 5 / across, bwFit / across);
  return [Math.min(nat, lo), Math.max(nat, hi)];
}

/**
 * The split whose seam lands at `x` (stage coordinates), clamped to the
 * range: what a drag follows, so the seam stays under the pointer 1:1.
 *
 * Plain arithmetic, because the range stops each end exactly where a column
 * would outgrow the stage's height. Inside it the pictures always span the
 * stage (`across`), so the seam sits at `box.x + s·across + gap/2`. Where
 * a column is height-limited the range has collapsed and there is nothing
 * to follow.
 */
export function splitAt(n: number, box: Rect, sp: MvSpacing, x: number): number {
  const [lo, hi] = splitRange(n, box, sp);
  const across = box.w - sp.gap;
  if (hi - lo < 1e-9 || across <= 0) return lo;
  return Math.min(hi, Math.max(lo, (x - box.x - sp.gap / 2) / across));
}

/** How far `[` and `]` move the split: 2% of the pictures' width, about
 * 30px in a 1600px window. */
export const SPLIT_STEP = 0.02;

/** The split one `[` (-1) or `]` (+1) away from `from`, clamped. */
export function nudgeSplit(n: number, box: Rect, sp: MvSpacing, from: number, dir: 1 | -1): number {
  const [lo, hi] = splitRange(n, box, sp);
  return Math.min(hi, Math.max(lo, from + dir * SPLIT_STEP));
}

function focus(k: number, box: Rect, sp: MvSpacing, want?: number): MvLayout {
  const { gap: g, caption: c } = sp;
  const n = k + 1;
  const [lo, hi] = splitRange(n, box, sp);
  const nat = naturalSplit(n, box, sp);
  const s = Math.min(hi, Math.max(lo, want ?? nat));
  const { bwFit, swFit, across } = fits(k, box, sp);
  // The pictures' combined width at this split: the whole stage, unless
  // one side would then be taller than it.
  const p = Math.max(
    0,
    Math.min(across, s > 0 ? bwFit / s : across, s < 1 ? swFit / (1 - s) : across),
  );
  const bw = s * p;
  const sw = p - bw;
  const bh = bw / R;
  const sh = sw / R;
  const bigH = bh + c;
  const stackH = k * (sh + c) + (k - 1) * g;
  const gh = Math.max(bigH, stackH);
  const gw = p + g;
  // Whichever column comes out shorter centres against the other.
  const rects: Rect[] = [{ x: 0, y: (gh - bigH) / 2, w: bw, h: bh }];
  const sy = (gh - stackH) / 2;
  for (let i = 0; i < k; i++) {
    rects.push({ x: bw + g, y: sy + i * (sh + c + g), w: sw, h: sh });
  }
  const tiles = centre(rects, gw, gh, box);
  const ox = box.x + (box.w - gw) / 2;
  const oy = box.y + (box.h - gh) / 2;
  return {
    tiles,
    split: s,
    seam: { x: ox + bw + g / 2, top: oy, bottom: oy + gh },
  };
}
