import { describe, expect, it } from "vitest";
import { inkSpan } from "./logoInk";

/** A w×h RGBA buffer, transparent, with the given columns inked on the
 * given rows. */
function logo(w: number, h: number, cols: [number, number], rows: number[] = [0]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (const y of rows)
    for (let x = cols[0]; x <= cols[1]; x++) {
      const i = (y * w + x) * 4;
      px[i] = 200;
      px[i + 3] = 255;
    }
  return px;
}

describe("inkSpan", () => {
  it("finds a mark set in the middle of a wide transparent file", () => {
    // Demon Slayer's shape: the emblem in the middle third.
    const s = inkSpan(logo(300, 4, [100, 199], [1, 2]), 300, 4);
    expect(s).toEqual({ left: 100 / 300, right: 100 / 300 });
  });

  it("keeps the two sides apart when the padding is lopsided", () => {
    const s = inkSpan(logo(100, 2, [30, 49]), 100, 2);
    expect(s).toEqual({ left: 0.3, right: 50 / 100 });
  });

  it("takes the widest reach across all rows", () => {
    const w = 50;
    const px = logo(w, 3, [20, 25], [0]);
    // A lower row reaches further both ways.
    for (let x = 10; x <= 40; x++) px[(2 * w + x) * 4 + 3] = 255;
    expect(inkSpan(px, w, 3)).toEqual({ left: 10 / w, right: 9 / w });
  });

  it("does not count a faint shadow's edge as ink", () => {
    const px = logo(40, 1, [10, 29]);
    px[2 * 4 + 3] = 8; // a wisp at x=2
    expect(inkSpan(px, 40, 1)).toEqual({ left: 10 / 40, right: 10 / 40 });
  });

  it("gives a file with no alpha zero on both sides", () => {
    const px = new Uint8ClampedArray(8 * 2 * 4).fill(255);
    expect(inkSpan(px, 8, 2)).toEqual({ left: 0, right: 0 });
  });

  it("gives nothing for a file with no ink", () => {
    expect(inkSpan(new Uint8ClampedArray(10 * 10 * 4), 10, 10)).toBeNull();
  });
});
