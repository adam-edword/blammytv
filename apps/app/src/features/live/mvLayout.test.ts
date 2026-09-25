import { describe, expect, it } from "vitest";
import {
  MV_SPACING,
  defaultKind,
  kindsFor,
  mvLayout,
  naturalSplit,
  nudgeSplit,
  SPLIT_STEP,
  splitAt,
  splitRange,
  type MvKind,
  type Rect,
} from "./mvLayout";

// The spacing the tab uses: a 14px gap and a 30px caption row.
const SP = MV_SPACING;

/** The stage a window leaves once the bar and the margins are taken out,
 * the way MultiviewTab computes it. */
const stage = (w: number, h: number): Rect => ({ x: 28, y: 92, w: w - 56, h: h - 92 - 28 });

const WINDOWS: Array<[number, number]> = [
  [1400, 900],
  [1920, 1080],
  [1280, 720],
];

const CASES: Array<[MvKind, number]> = [
  ["grid", 1],
  ["grid", 2],
  ["grid", 3],
  ["grid", 4],
  ["focus", 2],
  ["focus", 3],
  ["focus", 4],
];

/** A picture with its caption, the space a cell actually takes. */
const cell = (r: Rect): Rect => ({ ...r, h: r.h + SP.caption });

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 0.5 &&
  b.x < a.x + a.w - 0.5 &&
  a.y < b.y + b.h - 0.5 &&
  b.y < a.y + a.h - 0.5;

describe("mvLayout", () => {
  for (const [W, H] of WINDOWS) {
    const box = stage(W, H);
    for (const [kind, n] of CASES) {
      describe(`${kind} ${n} at ${W}x${H}`, () => {
        const { tiles } = mvLayout(kind, n, box, SP);

        it("has one picture per cell, none empty", () => {
          expect(tiles).toHaveLength(n);
          for (const t of tiles) expect(t.w).toBeGreaterThan(100);
        });

        it("draws every picture 16:9 within half a pixel", () => {
          for (const t of tiles) expect(Math.abs((t.w * 9) / 16 - t.h)).toBeLessThan(0.5);
        });

        it("overlaps nothing, captions included", () => {
          for (let i = 0; i < tiles.length; i++)
            for (let j = i + 1; j < tiles.length; j++)
              expect(overlap(cell(tiles[i]), cell(tiles[j]))).toBe(false);
        });

        it("stays inside the stage, captions included", () => {
          for (const t of tiles.map(cell)) {
            expect(t.x).toBeGreaterThanOrEqual(box.x - 0.5);
            expect(t.y).toBeGreaterThanOrEqual(box.y - 0.5);
            expect(t.x + t.w).toBeLessThanOrEqual(box.x + box.w + 0.5);
            expect(t.y + t.h).toBeLessThanOrEqual(box.y + box.h + 0.5);
          }
        });

        it("centres the group", () => {
          const cells = tiles.map(cell);
          const left = Math.min(...cells.map((t) => t.x)) - box.x;
          const right = box.x + box.w - Math.max(...cells.map((t) => t.x + t.w));
          const top = Math.min(...cells.map((t) => t.y)) - box.y;
          const bottom = box.y + box.h - Math.max(...cells.map((t) => t.y + t.h));
          expect(Math.abs(left - right)).toBeLessThan(0.5);
          expect(Math.abs(top - bottom)).toBeLessThan(0.5);
        });

        it("fills the stage one way or the other", () => {
          // Width-bound or height-bound, never shrunk for nothing.
          const cells = tiles.map(cell);
          const gw = Math.max(...cells.map((t) => t.x + t.w)) - Math.min(...cells.map((t) => t.x));
          const gh = Math.max(...cells.map((t) => t.y + t.h)) - Math.min(...cells.map((t) => t.y));
          expect(Math.max(gw / box.w, gh / box.h)).toBeGreaterThan(0.999);
        });
      });
    }
  }
});

describe("grid", () => {
  it("puts three as two over one, the one centred under the pair", () => {
    const { tiles } = mvLayout("grid", 3, stage(1400, 900), SP);
    const [a, b, c] = tiles;
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    expect(c.y).toBeGreaterThan(a.y + a.h);
    const pairMid = (a.x + b.x + b.w) / 2;
    expect(Math.abs(c.x + c.w / 2 - pairMid)).toBeLessThan(0.5);
  });
});

describe("focus", () => {
  it("lines the big tile up with the stack at the natural split", () => {
    for (const [W, H] of WINDOWS) {
      for (const n of [2, 3, 4]) {
        const { tiles } = mvLayout("focus", n, stage(W, H), SP);
        const big = cell(tiles[0]);
        const first = tiles[1];
        const last = cell(tiles[n - 1]);
        expect(Math.abs(big.y - first.y)).toBeLessThan(0.5);
        expect(Math.abs(big.y + big.h - (last.y + last.h))).toBeLessThan(0.5);
      }
    }
  });

  it("makes the big tile the big one", () => {
    const { tiles } = mvLayout("focus", 3, stage(1400, 900), SP);
    expect(tiles[0].w).toBeGreaterThan(tiles[1].w * 1.5);
  });

  it("takes a split and keeps every picture 16:9 at it", () => {
    const box = stage(1920, 1080);
    const [lo, hi] = splitRange(3, box, SP);
    expect(hi).toBeGreaterThan(lo);
    for (const s of [lo, (lo + hi) / 2, hi]) {
      const { tiles, split } = mvLayout("focus", 3, box, SP, s);
      expect(split).toBeCloseTo(s, 9);
      for (const t of tiles) expect(Math.abs((t.w * 9) / 16 - t.h)).toBeLessThan(0.5);
      for (const t of tiles.map(cell)) expect(t.y + t.h).toBeLessThanOrEqual(box.y + box.h + 0.5);
    }
  });

  it("centres the shorter column against the taller one off the natural split", () => {
    const box = stage(1920, 1080);
    const [lo, hi] = splitRange(3, box, SP);
    for (const s of [lo, hi]) {
      const { tiles } = mvLayout("focus", 3, box, SP, s);
      const big = cell(tiles[0]);
      const top = tiles[1].y;
      const bottom = cell(tiles[2]).y + cell(tiles[2]).h;
      const bigMid = big.y + big.h / 2;
      const stackMid = (top + bottom) / 2;
      expect(Math.abs(bigMid - stackMid)).toBeLessThan(0.5);
      // And they really are different heights here, or this proves nothing.
      expect(Math.abs(big.h - (bottom - top))).toBeGreaterThan(20);
    }
  });

  it("clamps the split at both ends", () => {
    const box = stage(1920, 1080);
    const [lo, hi] = splitRange(3, box, SP);
    expect(mvLayout("focus", 3, box, SP, 0).split).toBeCloseTo(lo, 9);
    expect(mvLayout("focus", 3, box, SP, 1).split).toBeCloseTo(hi, 9);
    // The rules the range stands for: the big tile at least half the
    // pictures, the small ones at least a fifth of the stage.
    expect(lo).toBeGreaterThanOrEqual(0.5);
    const { tiles } = mvLayout("focus", 3, box, SP, 1);
    expect(tiles[1].w).toBeGreaterThanOrEqual(box.w / 5 - 0.5);
  });

  it("keeps the natural split inside the range, whatever the fifth says", () => {
    for (const [W, H] of [...WINDOWS, [900, 700] as [number, number]]) {
      for (const n of [2, 3, 4]) {
        const box = stage(W, H);
        const [lo, hi] = splitRange(n, box, SP);
        const nat = naturalSplit(n, box, SP);
        expect(nat).toBeGreaterThanOrEqual(lo);
        expect(nat).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("does not move on a stage too short to give either side more", () => {
    // Wide and short: both columns are as tall as the stage already.
    const box = stage(2600, 700);
    const [lo, hi] = splitRange(3, box, SP);
    expect(hi - lo).toBeLessThan(1e-9);
    const { tiles } = mvLayout("focus", 3, box, SP, 0.9);
    expect(Math.abs(tiles[0].y - box.y)).toBeLessThan(0.5);
    expect(Math.abs(cell(tiles[0]).y + cell(tiles[0]).h - (box.y + box.h))).toBeLessThan(0.5);
  });

  it("puts the seam in the middle of the gap", () => {
    const { tiles, seam } = mvLayout("focus", 3, stage(1400, 900), SP);
    expect(seam).toBeDefined();
    expect(seam!.x - (tiles[0].x + tiles[0].w)).toBeCloseTo(SP.gap / 2, 6);
    expect(tiles[1].x - seam!.x).toBeCloseTo(SP.gap / 2, 6);
  });
});

describe("splitAt", () => {
  // Wide, short, narrow and tall stages, two to four tiles.
  const SHAPES: Array<[number, number, number]> = [
    [1920, 1080, 3],
    [1400, 700, 3],
    [1000, 900, 3],
    [1400, 900, 2],
    [900, 700, 4],
  ];

  it("finds the split whose seam lands under the pointer, 1:1", () => {
    for (const [W, H, n] of SHAPES) {
      const box = stage(W, H);
      const [lo, hi] = splitRange(n, box, SP);
      for (let i = 0; i <= 10; i++) {
        const s = lo + ((hi - lo) * i) / 10;
        const x = mvLayout("focus", n, box, SP, s).seam!.x;
        const found = splitAt(n, box, SP, x);
        expect(Math.abs(mvLayout("focus", n, box, SP, found).seam!.x - x)).toBeLessThan(0.01);
      }
    }
  });

  it("rests on the pictures spanning the stage at both ends of any range that moves", () => {
    for (const [W, H] of [...WINDOWS, [900, 700], [1400, 700], [1000, 900]] as Array<[number, number]>) {
      for (const n of [2, 3, 4]) {
        const box = stage(W, H);
        const [lo, hi] = splitRange(n, box, SP);
        if (hi - lo < 1e-9) continue;
        for (const s of [lo, hi]) {
          const { tiles } = mvLayout("focus", n, box, SP, s);
          expect(Math.abs(tiles[0].x - box.x)).toBeLessThan(0.01);
          expect(Math.abs(tiles[1].x + tiles[1].w - (box.x + box.w))).toBeLessThan(0.01);
        }
      }
    }
  });

  it("stops at the ends of the range past either end", () => {
    const box = stage(1920, 1080);
    const [lo, hi] = splitRange(3, box, SP);
    expect(splitAt(3, box, SP, -5000)).toBe(lo);
    expect(splitAt(3, box, SP, 99999)).toBe(hi);
  });

  it("stays put where the range has collapsed", () => {
    const box = stage(2600, 700);
    const [lo] = splitRange(3, box, SP);
    expect(splitAt(3, box, SP, 400)).toBe(lo);
    expect(splitAt(3, box, SP, 2000)).toBe(lo);
  });
});

describe("nudgeSplit", () => {
  it("steps by SPLIT_STEP each way and stops at the ends", () => {
    const box = stage(1920, 1080);
    const [lo, hi] = splitRange(3, box, SP);
    const nat = naturalSplit(3, box, SP);
    expect(nudgeSplit(3, box, SP, nat, 1)).toBeCloseTo(nat + SPLIT_STEP, 9);
    expect(nudgeSplit(3, box, SP, nat, -1)).toBeCloseTo(nat - SPLIT_STEP, 9);
    expect(nudgeSplit(3, box, SP, hi, 1)).toBe(hi);
    expect(nudgeSplit(3, box, SP, lo, -1)).toBe(lo);
  });
});

describe("kinds", () => {
  it("opens three in Focus and the rest in Grid", () => {
    expect(defaultKind(1)).toBe("grid");
    expect(defaultKind(2)).toBe("grid");
    expect(defaultKind(3)).toBe("focus");
    expect(defaultKind(4)).toBe("grid");
  });

  it("offers no Focus to a single tile", () => {
    expect(kindsFor(1)).toEqual(["grid"]);
    expect(kindsFor(3)).toEqual(["grid", "focus"]);
  });
});
