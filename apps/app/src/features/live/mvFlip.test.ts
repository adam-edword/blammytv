import { describe, expect, it } from "vitest";
import { invert } from "./mvFlip";

const box = (left: number, top: number, width: number) => ({ left, top, width, height: (width * 9) / 16 });

describe("invert", () => {
  it("draws a tile laid out at its new place back where it was, about its corner", () => {
    // Swapped into the big spot: it was a small tile on the right.
    const was = box(1088, 181, 484);
    const now = box(28, 181, 1046);
    const t = invert(was, now, true);
    const m = t?.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
    expect(m).not.toBeNull();
    const [dx, dy, s] = [Number(m![1]), Number(m![2]), Number(m![3])];
    // About the top-left corner: the corner lands on the old one, and the
    // width comes out at the old width.
    expect(now.left + dx).toBeCloseTo(was.left, 6);
    expect(now.top + dy).toBeCloseTo(was.top, 6);
    expect(now.width * s).toBeCloseTo(was.width, 6);
  });

  it("moves a caption without scaling it", () => {
    expect(invert(box(10, 20, 300), box(40, 60, 600), false)).toBe("translate(-30px, -40px) scale(1)");
  });

  it("says nothing moved under half a pixel", () => {
    expect(invert(box(10, 20, 300), box(10.3, 20.2, 300.1), true)).toBeNull();
  });
});
