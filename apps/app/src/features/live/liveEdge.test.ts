import { describe, expect, it } from "vitest";
import { EDGE_TOL, behindLive, livePctFor } from "./liveEdge";

// The readings this was built from, taken on a real live channel.
const EDGE = 16.544;
const AFTER_SEEK = 28.992;

describe("behindLive", () => {
  it("reads at-live before a baseline exists", () => {
    // Nothing has presented yet. Assuming live is right: the stream has just
    // been handed to us at whatever the provider considers now.
    expect(behindLive(20, null)).toBe(0);
    expect(behindLive(null, 16)).toBe(0);
  });

  it("reads at-live sitting at the edge", () => {
    expect(behindLive(EDGE, EDGE)).toBe(0);
  });

  it("measures a real seek back", () => {
    // 28.992 - 16.544 = 12.448, which is exactly the cache-time advance
    // (5.792) plus the time-pos rewind (6.656) from the same two readings.
    expect(behindLive(AFTER_SEEK, EDGE)).toBeCloseTo(12.448, 3);
  });

  it("ignores the demuxer running ahead in bursts", () => {
    // The forward buffer is not flat while sitting still, and without a floor
    // the indicator would drift off 100% for someone who touched nothing.
    expect(behindLive(EDGE + EDGE_TOL - 0.01, EDGE)).toBe(0);
    expect(behindLive(EDGE + EDGE_TOL + 0.5, EDGE)).toBeCloseTo(2.5, 3);
  });

  it("does not go negative when the buffer shrinks", () => {
    // A stall can leave cache-duration BELOW the baseline. That is not
    // "ahead of live", which does not exist.
    expect(behindLive(EDGE - 5, EDGE)).toBe(0);
  });

  it("stays put when mpv refuses the seek", () => {
    // The whole point. mpv declines to seek before the start of the buffer,
    // so cache-duration does not grow, so the indicator does not move —
    // where the old dead reckoning walked left on the keypress alone and
    // stayed wrong until a full stream reload.
    const refused = behindLive(EDGE, EDGE);
    expect(livePctFor(refused)).toBe(100);
  });
});

describe("livePctFor", () => {
  it("is full at the edge and clamps at both ends", () => {
    expect(livePctFor(0)).toBe(100);
    expect(livePctFor(-3)).toBe(100);
    expect(livePctFor(10_000)).toBe(0);
  });

  it("keeps the pre-existing 0.8%/sec scale", () => {
    expect(livePctFor(10)).toBeCloseTo(92, 6);
    expect(livePctFor(125)).toBe(0);
  });
});
