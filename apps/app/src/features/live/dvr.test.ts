import { describe, expect, it } from "vitest";
import {
  LIVE_TOL,
  dvrWindow,
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

describe("the constant is pinned with a literal", () => {
  // Asserting `100 - LIVE_TOL` would hold for any tolerance, which is how
  // this could have grown to 12s while the suite stayed green.
  it("holds still until told otherwise", () => {
    expect(LIVE_TOL).toBe(3);
  });
});

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

  it("floors an inverted window at zero depth", () => {
    // start > end should be impossible, but a poll landing across an
    // eviction could produce it, and a negative depth would invert the rail.
    expect(dvrDepth({ start: 100, end: 50, pos: 60 })).toBe(0);
    expect(dvrPct({ start: 100, end: 50, pos: 60 })).toBe(100);
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
  it("allows exactly three seconds of the demuxer running ahead", () => {
    expect(atLiveEdge({ start: 0, end: 100, pos: 100 })).toBe(true);
    expect(atLiveEdge({ start: 0, end: 100, pos: 97.5 })).toBe(true);
    // The boundary itself counts as live (`<=`).
    expect(atLiveEdge({ start: 0, end: 100, pos: 97 })).toBe(true);
    expect(atLiveEdge({ start: 0, end: 100, pos: 96.9 })).toBe(false);
    // Well behind is unambiguously behind — the case a widened tolerance
    // would have quietly swallowed.
    expect(atLiveEdge({ start: 0, end: 100, pos: 89 })).toBe(false);
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

  it("lands on the start when there is no window yet", () => {
    // Tune-in: the rail reads 100% and there is nothing to drag to, so any
    // drag has to resolve to the only second that exists rather than to a
    // fraction of nothing.
    expect(dvrSeekTarget({ start: 0, end: 0, pos: 0 }, 0.7)).toBe(0);
    expect(dvrSeekTarget({ start: 42, end: 42, pos: 42 }, 0.7)).toBe(42);
  });
});

describe("dvrChanged", () => {
  it("notices a moved playhead even when the window is unchanged", () => {
    // The case that matters most and was untested: after seeking back into
    // the buffer on a stalled stream, `end` is flat and only `pos` moves.
    // Miss this and the playhead freezes exactly when the rail is being used.
    expect(dvrChanged(REAL, { ...REAL, pos: REAL.pos + 4 })).toBe(true);
  });

  it("notices the window start advancing as back buffer is evicted", () => {
    expect(dvrChanged(REAL, { ...REAL, start: REAL.start + 4 })).toBe(true);
  });

  it("notices the live edge advancing", () => {
    expect(dvrChanged(REAL, { ...REAL, end: REAL.end + 4 })).toBe(true);
  });

  it("ignores drift below half a second on every field", () => {
    // Without this the overlay re-renders twice a second forever, because
    // `end` advances continuously on a live stream.
    expect(dvrChanged(REAL, { ...REAL, end: REAL.end + 0.5 })).toBe(false);
    expect(dvrChanged(REAL, { ...REAL, start: REAL.start + 0.5 })).toBe(false);
    expect(dvrChanged(REAL, { ...REAL, pos: REAL.pos + 0.5 })).toBe(false);
    // Just past the boundary on each.
    expect(dvrChanged(REAL, { ...REAL, end: REAL.end + 0.51 })).toBe(true);
    expect(dvrChanged(REAL, { ...REAL, start: REAL.start + 0.51 })).toBe(true);
    expect(dvrChanged(REAL, { ...REAL, pos: REAL.pos + 0.51 })).toBe(true);
  });

  it("handles appearing and disappearing", () => {
    expect(dvrChanged(null, REAL)).toBe(true);
    expect(dvrChanged(REAL, null)).toBe(true);
    expect(dvrChanged(null, null)).toBe(false);
  });
});

describe("dvrWindow — the live edge is not the range end", () => {
  // The exact reading from a Cartoon Network channel, fresh load, viewer
  // sitting AT live:
  //   seekable-ranges [{start: 0, end: 24.511}]
  //   reader-pts (playhead)                6.507
  //   demuxer-cache-duration (the gap)    18.219
  const START = 0;
  const RANGE_END = 24.511;
  const POS = 6.507;
  const GAP = 18.219;

  it("puts the viewer AT live on that reading", () => {
    // Drawing to the raw range end would have parked the knob at 27% while
    // the viewer was live, because the demuxer runs 18s ahead of playback.
    const raw = { start: START, end: RANGE_END, pos: POS };
    expect(dvrPct(raw)).toBeCloseTo(26.5, 0);
    expect(atLiveEdge(raw)).toBe(false);

    const w = dvrWindow(START, RANGE_END, POS, GAP);
    expect(w).not.toBeNull();
    expect(w!.end).toBeCloseTo(6.292, 3);
    expect(dvrPct(w!)).toBe(100);
    expect(atLiveEdge(w!)).toBe(true);
  });

  it("offers rewind back to the start of what is retained", () => {
    // Just tuned in, so there is only about as much history as the playhead
    // has travelled.
    expect(dvrDepth(dvrWindow(START, RANGE_END, POS, GAP)!)).toBeCloseTo(6.292, 3);
  });

  it("reports being behind by exactly how far back you seeked", () => {
    // A channel that has been running a while, so there is real history.
    // The live edge is rangeEnd minus the natural gap.
    const EDGE = 300 - GAP; // 281.781
    expect(dvrBehind(dvrWindow(0, 300, EDGE, GAP)!)).toBe(0);
    const back10 = dvrWindow(0, 300, EDGE - 10, GAP)!;
    expect(dvrBehind(back10)).toBeCloseTo(10, 6);
    expect(atLiveEdge(back10)).toBe(false);
    // Within the tolerance is still live: the demuxer lands segments in
    // bursts, so the gap is never a flat zero.
    expect(atLiveEdge(dvrWindow(0, 300, EDGE - 2, GAP)!)).toBe(true);
  });

  it("draws nothing until the baseline has settled", () => {
    // A window built on a wrong gap is worse than no window: it is the
    // 95%-forever bug with a draggable handle attached.
    expect(dvrWindow(START, RANGE_END, POS, null)).toBeNull();
  });

  it("draws nothing when mpv reported no range", () => {
    expect(dvrWindow(null, RANGE_END, POS, GAP)).toBeNull();
    expect(dvrWindow(START, null, POS, GAP)).toBeNull();
    expect(dvrWindow(START, RANGE_END, null, GAP)).toBeNull();
  });

  it("draws nothing when the edge has not cleared the start yet", () => {
    // The first seconds of a channel: everything buffered is still ahead of
    // the playhead, so there is no rewind window to show.
    expect(dvrWindow(0, 12, 1, 18.219)).toBeNull();
    expect(dvrWindow(0, 18.219, 1, 18.219)).toBeNull();
  });
});
