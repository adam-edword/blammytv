import { describe, expect, it } from "vitest";
import { findHitches, hlsConfig, mpegtsConfig } from "./multiviewTuning";

describe("mpegtsConfig", () => {
  it("smooth never jumps and never changes speed", () => {
    // The library's own buffering, untouched. Adam's streams keep a bursty
    // 6 to 14s cushion, and every catch-up threshold tried flipped the
    // audio tile between 1x and 1.1x (v0.9.102, v0.9.103).
    const c = mpegtsConfig("smooth");
    expect(c.liveBufferLatencyChasing).toBeUndefined();
    expect(c.liveSync).toBeUndefined();
    expect(c.enableStashBuffer).toBeUndefined();
  });

  it("chase is what v0.9.101 shipped, for the A/B", () => {
    expect(mpegtsConfig("chase")).toMatchObject({
      enableStashBuffer: false,
      liveBufferLatencyChasing: true,
    });
  });

  it("either keeps 30s behind the playhead, not the library's 180 (plan 018, P2)", () => {
    for (const p of ["smooth", "chase"] as const)
      expect(mpegtsConfig(p)).toMatchObject({
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 20,
      });
    expect(hlsConfig()).toMatchObject({ backBufferLength: 30 });
  });
});

describe("findHitches", () => {
  const steady = (fps: number, n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => from + (i * 1000) / fps);

  it("finds a freeze in a 60fps stream, and when it started", () => {
    const before = steady(60, 120);
    const last = before[before.length - 1];
    const after = steady(60, 120, last + 250);
    const h = findHitches([...before, ...after]);
    expect(h).toHaveLength(1);
    expect(h[0].at).toBeCloseTo(last);
    expect(h[0].gap).toBeCloseTo(250);
  });

  it("never calls a steady 30fps or 24fps stream a hitch", () => {
    expect(findHitches(steady(30, 300))).toEqual([]);
    expect(findHitches(steady(24, 300))).toEqual([]);
  });

  it("ignores a gap too short to see, even at 3x the frame time", () => {
    const a = steady(60, 60);
    const b = steady(60, 60, a[a.length - 1] + 60);
    expect(findHitches([...a, ...b])).toEqual([]);
  });

  it("says nothing with too few frames to judge", () => {
    expect(findHitches([])).toEqual([]);
    expect(findHitches([0])).toEqual([]);
  });
});
