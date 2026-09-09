import { describe, expect, it } from "vitest";
import {
  allowedSizes,
  capLine,
  tileRects,
  usableSize,
  type Box,
  type GridSize,
} from "./multiview";

/** A 16:9 box at a round size, so the arithmetic in the assertions is
 * readable rather than a pile of decimals. */
const BOX: Box = { x: 0, y: 0, w: 1600, h: 900 };

const right = (b: Box) => b.x + b.w;
const bottom = (b: Box) => b.y + b.h;

describe("tileRects", () => {
  it("gives one rect per tile", () => {
    for (const n of [2, 3, 4] as GridSize[]) {
      expect(tileRects(BOX, n, 8)).toHaveLength(n);
    }
  });

  it("fills the box exactly, with no outer padding", () => {
    // The clip holes are cut at these rects, so a tile short of the edge
    // would show a strip of stale webview rather than black.
    for (const n of [2, 3, 4] as GridSize[]) {
      const tiles = tileRects(BOX, n, 10);
      expect(Math.min(...tiles.map((t) => t.x))).toBe(BOX.x);
      expect(Math.min(...tiles.map((t) => t.y))).toBe(BOX.y);
      expect(Math.max(...tiles.map(right))).toBe(right(BOX));
      expect(Math.max(...tiles.map(bottom))).toBe(bottom(BOX));
    }
  });

  it("puts the gap between tiles and nowhere else", () => {
    const [l, r] = tileRects(BOX, 2, 20);
    expect(r.x - right(l)).toBe(20);
    expect(l.w).toBe(r.w);
  });

  it("2-up is side by side, full height", () => {
    const tiles = tileRects(BOX, 2, 0);
    expect(tiles).toEqual([
      { x: 0, y: 0, w: 800, h: 900 },
      { x: 800, y: 0, w: 800, h: 900 },
    ]);
  });

  it("3-up is one big plus two stacked, and beats three in a row on picture", () => {
    const tiles = tileRects(BOX, 3, 0);
    expect(tiles[0]).toEqual({ x: 0, y: 0, w: 1600 * (2 / 3), h: 900 });
    // The two smalls share the remaining third, stacked.
    expect(tiles[1].w).toBeCloseTo(1600 / 3);
    expect(tiles[2].w).toBeCloseTo(1600 / 3);
    expect(tiles[1].h).toBe(450);
    expect(tiles[2].y).toBe(450);

    // The reason it is this shape rather than a row: total 16:9 picture
    // area, with each video fitted inside its cell.
    const fitted = (b: Box) => {
      const s = Math.min(b.w / 16, b.h / 9);
      return 16 * s * (9 * s);
    };
    const oneBigTwoSmall = tiles.reduce((sum, t) => sum + fitted(t), 0);
    const threeInARow = [0, 1, 2]
      .map((i) => ({ x: i * (1600 / 3), y: 0, w: 1600 / 3, h: 900 }))
      .reduce((sum, t) => sum + fitted(t), 0);
    expect(oneBigTwoSmall).toBeGreaterThan(threeInARow);
  });

  it("4-up is a 2x2 in slot order, reading across then down", () => {
    const tiles = tileRects(BOX, 4, 0);
    expect(tiles).toEqual([
      { x: 0, y: 0, w: 800, h: 450 },
      { x: 800, y: 0, w: 800, h: 450 },
      { x: 0, y: 450, w: 800, h: 450 },
      { x: 800, y: 450, w: 800, h: 450 },
    ]);
  });

  it("never inverts a tile when the gap is wider than the box", () => {
    // A collapsed box during a transition is ordinary, not exceptional.
    for (const n of [2, 3, 4] as GridSize[]) {
      for (const box of [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 0, y: 0, w: 0, h: 0 },
      ]) {
        for (const t of tileRects(box, n, 40)) {
          expect(t.w).toBeGreaterThanOrEqual(0);
          expect(t.h).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("allowedSizes", () => {
  it("offers everything when the line does not publish a limit", () => {
    // Stalker and M3U have no API to ask. Refusing a feature because we
    // could not ask is worse than letting it try.
    expect(allowedSizes(null)).toEqual([2, 3, 4]);
    expect(allowedSizes(undefined)).toEqual([2, 3, 4]);
  });

  it("caps at what the line carries", () => {
    expect(allowedSizes({ max: 5 })).toEqual([2, 3, 4]);
    expect(allowedSizes({ max: 4 })).toEqual([2, 3, 4]);
    // Adam's own line.
    expect(allowedSizes({ max: 3 })).toEqual([2, 3]);
    expect(allowedSizes({ max: 2 })).toEqual([2]);
  });

  it("says no at all on a one-connection line", () => {
    // mpv.rs's unload doc: such a line outright fails to tune with a second
    // stream open, so there is no grid to offer.
    expect(allowedSizes({ max: 1 })).toEqual([]);
  });

  it("ignores what is currently in use", () => {
    // `active` counts this app's own stream, which opening the grid
    // releases first, so subtracting it would under-offer every time.
    expect(allowedSizes({ max: 4, active: 3 } as { max: number })).toEqual([
      2, 3, 4,
    ]);
  });
});

describe("usableSize", () => {
  it("keeps the viewer's choice when the line allows it", () => {
    expect(usableSize(4, { max: 4 })).toBe(4);
    expect(usableSize(2, { max: 3 })).toBe(2);
  });

  it("clamps down rather than refusing", () => {
    // Chose 4 on one playlist, switched to a 3-connection one: 3 is what
    // they meant.
    expect(usableSize(4, { max: 3 })).toBe(3);
    expect(usableSize(4, { max: 2 })).toBe(2);
  });

  it("is null only when the line cannot do multiview at all", () => {
    expect(usableSize(2, { max: 1 })).toBeNull();
    expect(usableSize(4, null)).toBe(4);
  });
});

describe("capLine", () => {
  it("says the number, because that is the actionable part", () => {
    expect(capLine({ max: 3 })).toContain("3");
    expect(capLine({ max: 6 })).toContain("6");
  });

  it("tells a big line it is not the constraint", () => {
    expect(capLine({ max: 5 })).toMatch(/any size works/);
  });

  it("tells a tight line what it caps out at", () => {
    expect(capLine({ max: 3 })).toMatch(/biggest grid/);
    expect(capLine({ max: 2 })).toMatch(/biggest grid/);
  });

  it("says outright when multi-view cannot run at all", () => {
    // Better than letting someone find out by opening four dead tiles.
    expect(capLine({ max: 1 })).toMatch(/can.t run/);
  });

  it("does not invent a number it was never given", () => {
    for (const c of [null, undefined]) {
      expect(capLine(c)).not.toMatch(/\d/);
      expect(capLine(c)).toMatch(/report a limit/);
    }
  });
});
