import { describe, expect, it } from "vitest";
import {
  EDGE_TOL,
  PCT_PER_SEC,
  SETTLE_MS,
  behindLive,
  livePctFor,
  nextBaseline,
} from "./liveEdge";

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

describe("nextBaseline", () => {
  const fresh = { loading: false, sincePresent: 0, seeked: false };

  it("holds nothing while still tuning", () => {
    expect(nextBaseline(null, { ...fresh, loading: true, cacheDur: 16.5 })).toBeNull();
    // ...and a re-arm discards whatever was there.
    expect(
      nextBaseline({ gap: 18, settling: false }, { ...fresh, loading: true, cacheDur: 9 }),
    ).toBeNull();
  });

  it("takes the MAXIMUM gap while settling, not the first", () => {
    // The bug this replaces: the buffer is still filling when the picture
    // appears, so the first reading is far below the steady size. Measured on
    // a real channel it read ~12 against a settled 18.2, which put the live
    // edge 6s ahead of the playhead forever — the rail sat at 95% and Jump to
    // live refilled the buffer and landed in exactly the same place.
    let b = nextBaseline(null, { ...fresh, cacheDur: 4 });
    expect(b).toEqual({ gap: 4, settling: true });
    b = nextBaseline(b, { ...fresh, cacheDur: 11, sincePresent: 2000 });
    b = nextBaseline(b, { ...fresh, cacheDur: 18.219, sincePresent: 5000 });
    // A dip must not drag it back down.
    b = nextBaseline(b, { ...fresh, cacheDur: 17.4, sincePresent: 7000 });
    expect(b).toEqual({ gap: 18.219, settling: true });
  });

  it("freezes once the settle window closes", () => {
    const b = nextBaseline({ gap: 18.219, settling: true }, {
      ...fresh,
      cacheDur: 30,
      sincePresent: SETTLE_MS,
    });
    expect(b).toEqual({ gap: 18.219, settling: false });
    // ...and stays frozen against anything afterwards.
    expect(
      nextBaseline(b, { ...fresh, cacheDur: 99, sincePresent: 60_000 }),
    ).toEqual({ gap: 18.219, settling: false });
  });

  it("freezes the instant the user seeks, even mid-settle", () => {
    // A seek back inflates the gap by exactly the amount seeked. Absorbing
    // that would redefine live as wherever the user is standing, after which
    // the indicator could never report being behind again.
    const b = nextBaseline({ gap: 12, settling: true }, {
      ...fresh,
      cacheDur: 42,
      sincePresent: 1000,
      seeked: true,
    });
    expect(b).toEqual({ gap: 12, settling: false });
  });

  it("keeps what it has when the field is absent", () => {
    expect(nextBaseline(null, { ...fresh, cacheDur: undefined })).toBeNull();
    expect(
      nextBaseline({ gap: 18, settling: true }, { ...fresh, cacheDur: null }),
    ).toEqual({ gap: 18, settling: true });
  });

  it("treats a zero gap as a real reading", () => {
    expect(nextBaseline(null, { ...fresh, cacheDur: 0 })).toEqual({
      gap: 0,
      settling: true,
    });
  });

  it("pins the settle window with a literal", () => {
    expect(SETTLE_MS).toBe(10_000);
  });
});
