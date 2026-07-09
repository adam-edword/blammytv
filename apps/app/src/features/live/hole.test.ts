import { describe, expect, it } from "vitest";
import { frostRegion, holeClip } from "./hole";

/** Pull the inner (cutout) subpath out of the clip string. */
const inner = (clip: string) => clip.slice(clip.indexOf("Z ") + 2, -2);

describe("holeClip", () => {
  it("wraps the cutout in the full-window outer rect", () => {
    expect(holeClip(10, 20, 110, 220, 0, 1920, 1080)).toMatch(
      /^path\("M0 0H1920V1080H0Z /,
    );
  });

  it("radius 0 traces the sharp rect counter-clockwise, no arcs", () => {
    const d = inner(holeClip(10, 20, 110, 220, 0, 1920, 1080));
    expect(d).toBe("M10 20L10 220L110 220L110 20Z");
    expect(d).not.toContain("A");
  });

  it("radius > 0 emits 4 arcs at the requested radius", () => {
    const d = inner(holeClip(10, 20, 110, 220, 8, 1920, 1080));
    expect(d.match(/A8 8 /g)).toHaveLength(4);
  });

  it("clamps the radius to half the shorter side", () => {
    // 10px-wide rect can't take a 40px radius: corners cap at width/2 = 5.
    const d = inner(holeClip(100, 0, 110, 200, 40, 1920, 1080));
    expect(d.match(/A5 5 /g)).toHaveLength(4);
  });

  it("keeps the rounded cutout on the l/t/r/b bounds", () => {
    // Endpoint of each M/L/A command; arc params (rx ry rot large sweep)
    // are stripped so only real coordinates remain.
    const pts = [
      ...inner(holeClip(10, 20, 110, 220, 8, 1920, 1080)).matchAll(
        /(?:M|L|A\d+ \d+ \d+ \d+ \d+ )(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pts).toHaveLength(8); // 4 arc ends + M + 3 line ends
    expect(Math.min(...pts.map((p) => p[0]))).toBe(10);
    expect(Math.max(...pts.map((p) => p[0]))).toBe(110);
    expect(Math.min(...pts.map((p) => p[1]))).toBe(20);
    expect(Math.max(...pts.map((p) => p[1]))).toBe(220);
  });
});

describe("frostRegion", () => {
  const slot = { left: 100, top: 50, width: 200, height: 100 };

  it("normalizes a card fully inside the slot", () => {
    expect(
      frostRegion(slot, { left: 150, top: 75, right: 250, bottom: 125 }),
    ).toEqual({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
  });

  it("clamps a card that spills past the edges", () => {
    expect(
      frostRegion(slot, { left: 0, top: 100, right: 200, bottom: 400 }),
    ).toEqual({ x0: 0, y0: 0.5, x1: 0.5, y1: 1 });
  });

  it("returns the identity region for card == slot", () => {
    expect(
      frostRegion(slot, { left: 100, top: 50, right: 300, bottom: 150 }),
    ).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it("returns null when there is nothing to frost", () => {
    // Card entirely right of the slot: both x-es clamp to 1.
    expect(
      frostRegion(slot, { left: 400, top: 60, right: 500, bottom: 90 }),
    ).toBeNull();
    // Card entirely above the slot.
    expect(
      frostRegion(slot, { left: 150, top: 0, right: 250, bottom: 40 }),
    ).toBeNull();
    // Zero-size slot can't be normalized against.
    expect(
      frostRegion(
        { left: 0, top: 0, width: 0, height: 100 },
        { left: 0, top: 0, right: 10, bottom: 10 },
      ),
    ).toBeNull();
  });
});
