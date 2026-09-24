import { describe, expect, it } from "vitest";
import { findHitches, mpegtsConfig } from "./multiviewTuning";

describe("mpegtsConfig", () => {
  it("smooth never seeks to chase the live edge", () => {
    const c = mpegtsConfig("smooth");
    expect(c.liveBufferLatencyChasing).toBeUndefined();
    // The stash buffer is left at the library's default (on).
    expect(c.enableStashBuffer).toBeUndefined();
    expect(c.liveSync).toBe(true);
    expect(c.liveSyncPlaybackRate).toBe(1.1);
  });

  it("smooth leaves the stream's normal cushion alone", () => {
    // Adam's streams sit 6 to 8s ahead on their own (v0.9.102's stats). A
    // threshold inside that range plays them at 1.1x all the time.
    const c = mpegtsConfig("smooth");
    expect(c.liveSyncMaxLatency).toBeGreaterThan(8.4);
    expect(c.liveSyncTargetLatency).toBeGreaterThanOrEqual(8);
  });

  it("chase is exactly what v0.9.101 shipped, for the A/B", () => {
    expect(mpegtsConfig("chase")).toEqual({
      enableStashBuffer: false,
      liveBufferLatencyChasing: true,
    });
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
