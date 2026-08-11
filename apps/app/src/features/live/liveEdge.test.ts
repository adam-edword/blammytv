import { describe, expect, it } from "vitest";
import { EDGE_TOL, PCT_PER_SEC, behindLive, livePctFor } from "./liveEdge";

// The readings this was built from, taken on a real live channel.
const EDGE = 16.544;
const AFTER_SEEK = 28.992;

describe("the constants are pinned with literals", () => {
  // Every assertion below is written against these numbers rather than
  // against the exports. Asserting `EDGE + EDGE_TOL` would pass for any
  // value of EDGE_TOL, which is how a 2s tolerance could have silently
  // become 12s.
  it("holds still until told otherwise", () => {
    expect(EDGE_TOL).toBe(2);
    expect(PCT_PER_SEC).toBe(0.8);
  });
});

describe("behindLive", () => {
  it("reads at-live before a baseline exists", () => {
    // Nothing has presented yet. Assuming live is right: the stream has just
    // been handed to us at whatever the provider considers now.
    expect(behindLive(20, null)).toBe(0);
    expect(behindLive(null, 16)).toBe(0);
    expect(behindLive(undefined, 16)).toBe(0);
  });

  it("treats a ZERO baseline as a real baseline, not as absent", () => {
    // The guard is `== null` and it has to stay that way. Rewritten as a
    // falsy check (`!cacheDur || !baseline`) this returns 0 forever and the
    // indicator claims you are live no matter how far back you rewind. A
    // baseline of 0 is reachable: it is captured from the first reading once
    // the picture is up, and a stream that presents with an empty forward
    // buffer reads 0.0 there.
    expect(behindLive(20, 0)).toBe(20);
    expect(behindLive(0, 0)).toBe(0);
  });

  it("reads at-live sitting at the edge", () => {
    expect(behindLive(EDGE, EDGE)).toBe(0);
  });

  it("measures a real seek back", () => {
    // 28.992 - 16.544 = 12.448, which is exactly the cache-time advance
    // (5.792) plus the time-pos rewind (6.656) from the same two readings.
    expect(behindLive(AFTER_SEEK, EDGE)).toBeCloseTo(12.448, 3);
  });

  it("ignores the demuxer running ahead in bursts, to exactly 2 seconds", () => {
    // The forward buffer is not flat while sitting still, and without a floor
    // the indicator would drift off 100% for someone who touched nothing.
    expect(behindLive(EDGE + 1.99, EDGE)).toBe(0);
    // The boundary itself is INSIDE the tolerance (`<=`).
    expect(behindLive(EDGE + 2, EDGE)).toBe(0);
    expect(behindLive(EDGE + 2.5, EDGE)).toBeCloseTo(2.5, 6);
  });

  it("does not go negative when the buffer shrinks", () => {
    // A stall can leave cache-duration BELOW the baseline. That is not
    // "ahead of live", which does not exist.
    expect(behindLive(EDGE - 5, EDGE)).toBe(0);
  });

  it("does not move when mpv refuses the seek", () => {
    // The whole point of measuring rather than dead-reckoning. mpv declines
    // to seek before the start of the buffer, so cache-duration is unchanged
    // between two readings and the indicator must be unchanged with it.
    const before = behindLive(EDGE + 9, EDGE);
    const afterRefusedSeek = behindLive(EDGE + 9, EDGE);
    expect(afterRefusedSeek).toBe(before);
    expect(livePctFor(afterRefusedSeek)).toBeCloseTo(100 - 9 * 0.8, 6);
  });
});

describe("livePctFor", () => {
  it("is full at the edge and clamps at both ends", () => {
    expect(livePctFor(0)).toBe(100);
    expect(livePctFor(-3)).toBe(100);
    expect(livePctFor(10_000)).toBe(0);
  });

  it("empties the rail at 125 seconds back", () => {
    // 0.8%/sec, asserted as arithmetic on literals rather than on the
    // exported constant.
    expect(livePctFor(10)).toBeCloseTo(92, 6);
    expect(livePctFor(62.5)).toBeCloseTo(50, 6);
    expect(livePctFor(125)).toBe(0);
  });
});
