import { describe, expect, it } from "vitest";
import {
  PX_PER_MIN,
  cellRect,
  progress,
  ticks,
  windowStart,
  xForTime,
} from "./guide";

const at = (h: number, m: number) => new Date(2026, 5, 30, h, m);

describe("windowStart", () => {
  it("floors to the previous half hour", () => {
    expect(windowStart(at(20, 38))).toEqual(at(20, 30));
    expect(windowStart(at(20, 29))).toEqual(at(20, 0));
    expect(windowStart(at(20, 0))).toEqual(at(20, 0));
  });
});

describe("layout", () => {
  const start = at(20, 30);

  it("positions times at PX_PER_MIN density", () => {
    expect(xForTime(at(21, 0), start)).toBe(30 * PX_PER_MIN);
  });

  it("emits a tick per half hour", () => {
    const t = ticks(start);
    expect(t).toHaveLength(8);
    expect(t[1]).toEqual(at(21, 0));
  });

  it("clamps cells to the window and drops off-window ones", () => {
    // Started before the window: clamped to the left edge.
    expect(cellRect(at(20, 0), at(21, 0), start)).toEqual({
      x: 0,
      w: 30 * PX_PER_MIN,
    });
    // Fully before the window: gone.
    expect(cellRect(at(19, 0), at(20, 30), start)).toBeNull();
    // Runs past the window: clamped to the right edge.
    const clipped = cellRect(at(23, 30), at(25, 0), start)!;
    expect(clipped.x).toBe(180 * PX_PER_MIN);
    expect(clipped.w).toBe(60 * PX_PER_MIN);
  });
});

describe("progress", () => {
  it("clamps to 0..1", () => {
    expect(progress(at(20, 0), at(21, 0), at(20, 30))).toBe(0.5);
    expect(progress(at(20, 0), at(21, 0), at(19, 0))).toBe(0);
    expect(progress(at(20, 0), at(21, 0), at(22, 0))).toBe(1);
  });
});
