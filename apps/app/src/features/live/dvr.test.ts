import { describe, expect, it } from "vitest";
import {
  LIVE_TOL,
  atLiveEdge,
  dvrBehind,
  dvrChanged,
  dvrDepth,
  dvrPct,
  dvrSeekTarget,
  type DvrWindow,
} from "./dvr";

// The reading this was built from: a real channel, 29s after tuning in.
const REAL: DvrWindow = { start: 0, end: 28.029, pos: 7.84 };

describe("the window", () => {
  it("measures depth and behind-live from the real reading", () => {
    expect(dvrDepth(REAL)).toBeCloseTo(28.029, 3);
    expect(dvrBehind(REAL)).toBeCloseTo(20.189, 3);
  });

  it("places the playhead across the window", () => {
    expect(dvrPct(REAL)).toBeCloseTo((7.84 / 28.029) * 100, 6);
    expect(dvrPct({ start: 0, end: 100, pos: 50 })).toBe(50);
    expect(dvrPct({ start: 60, end: 160, pos: 110 })).toBe(50);
  });

  it("reads a window with no depth as live, not as zero", () => {
    // The first moments of every channel: nothing to rewind, so you ARE
    // live. An empty bar pinned left would say the opposite.
    expect(dvrPct({ start: 0, end: 0, pos: 0 })).toBe(100);
    expect(dvrDepth({ start: 0, end: 0, pos: 0 })).toBe(0);
  });

  it("clamps a playhead outside its own window", () => {
    // The window's start advances as mpv evicts back buffer, and a poll can
    // land with pos fractionally behind it.
    expect(dvrPct({ start: 10, end: 100, pos: 5 })).toBe(0);
    expect(dvrPct({ start: 0, end: 100, pos: 140 })).toBe(100);
    expect(dvrBehind({ start: 0, end: 100, pos: 140 })).toBe(0);
  });
});

describe("atLiveEdge", () => {
  it("allows for the demuxer running ahead in bursts", () => {
    expect(atLiveEdge({ start: 0, end: 100, pos: 100 })).toBe(true);
    expect(atLiveEdge({ start: 0, end: 100, pos: 100 - LIVE_TOL + 0.1 })).toBe(true);
    expect(atLiveEdge({ start: 0, end: 100, pos: 100 - LIVE_TOL - 0.1 })).toBe(false);
  });

  it("is false where the old indicator was wrong", () => {
    expect(atLiveEdge(REAL)).toBe(false);
  });
});

describe("dvrSeekTarget", () => {
  it("maps the rail onto real seconds", () => {
    expect(dvrSeekTarget(REAL, 0)).toBe(0);
    expect(dvrSeekTarget(REAL, 1)).toBeCloseTo(28.029, 3);
    expect(dvrSeekTarget(REAL, 0.5)).toBeCloseTo(14.0145, 3);
  });

  it("cannot be dragged outside the window", () => {
    // The whole point: you can no longer ask for a position the stream does
    // not hold, which is what left the old indicator stranded.
    expect(dvrSeekTarget(REAL, -2)).toBe(0);
    expect(dvrSeekTarget(REAL, 9)).toBeCloseTo(28.029, 3);
  });

  it("offsets by the window start, not from zero", () => {
    expect(dvrSeekTarget({ start: 600, end: 700, pos: 650 }, 0.5)).toBe(650);
  });
});

describe("dvrChanged", () => {
  it("ignores sub-half-second drift so the overlay is not re-rendered twice a second", () => {
    expect(dvrChanged(REAL, { ...REAL, end: REAL.end + 0.2 })).toBe(false);
    expect(dvrChanged(REAL, { ...REAL, end: REAL.end + 0.9 })).toBe(true);
  });

  it("handles appearing and disappearing", () => {
    expect(dvrChanged(null, REAL)).toBe(true);
    expect(dvrChanged(REAL, null)).toBe(true);
    expect(dvrChanged(null, null)).toBe(false);
  });
});
