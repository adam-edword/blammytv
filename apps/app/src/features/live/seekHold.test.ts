import { describe, expect, it } from "vitest";
import {
  HOLD_MS,
  HOLD_TOL,
  holdsPoll,
  nextHold,
  nextHoldAbs,
  type SeekHold,
} from "./seekHold";

const at = 1000;
const hold: SeekHold = { target: 4000, at };

describe("holdsPoll", () => {
  it("trusts every poll when no seek is in flight", () => {
    expect(holdsPoll(null, 20, at)).toBe(false);
  });

  it("discards the position the seek was moving AWAY from", () => {
    // The measured regression: released at 74.8% of a 90 minute film, one
    // stale push read 22.3% and the bar jumped back.
    expect(holdsPoll(hold, 1202, at + 100)).toBe(true);
  });

  it("releases as soon as mpv reports where it was asked to go", () => {
    expect(holdsPoll(hold, 4000, at + 100)).toBe(false);
  });

  it("allows exactly two seconds for the clock moving on since it landed", () => {
    // Playback resumes the moment the seek completes, so the first poll to
    // observe it reads slightly past the target. That is arrival, not drift.
    // Literals, not `4000 + HOLD_TOL`: that would hold for any tolerance,
    // which is how "landed" could silently widen by 50%.
    expect(holdsPoll(hold, 4001.9, at + 400)).toBe(false);
    // The boundary itself counts as landed (the test is `>`).
    expect(holdsPoll(hold, 4002, at + 400)).toBe(false);
    expect(holdsPoll(hold, 4002.1, at + 400)).toBe(true);
    expect(holdsPoll(hold, 3998, at + 400)).toBe(false);
    expect(holdsPoll(hold, 3997.9, at + 400)).toBe(true);
  });

  it("pins the constants with literals", () => {
    expect(HOLD_TOL).toBe(2);
    expect(HOLD_MS).toBe(1500);
  });

  it("gives up rather than lying indefinitely", () => {
    // The unseekable-source case: mpv silently refuses, so the position
    // never approaches the target. Holding forever would leave the scrubber
    // permanently wrong. At the deadline the truth wins, however unwelcome.
    expect(holdsPoll(hold, 1202, at + HOLD_MS - 1)).toBe(true);
    expect(holdsPoll(hold, 1202, at + HOLD_MS)).toBe(false);
  });

  it("holds a backwards seek too", () => {
    const back: SeekHold = { target: 500, at };
    expect(holdsPoll(back, 2400, at + 100)).toBe(true);
    expect(holdsPoll(back, 500.4, at + 100)).toBe(false);
  });

  it("is not a blanket mute for the hold window", () => {
    // Ignoring everything for HOLD_MS would make a failed seek look fine and
    // then jump — the same defect with a delay bolted on. A correct landing
    // has to end the hold early, which is what the target test is for.
    let released = 0;
    for (let t = 0; t < HOLD_MS; t += 100)
      if (!holdsPoll(hold, 4000.2, at + t)) released++;
    expect(released).toBe(HOLD_MS / 100);
  });
});

const CLOCK = { pos: 100, dur: 9318.309 };

describe("nextHold", () => {
  it("aims from the last polled position on a first seek", () => {
    expect(nextHold(null, CLOCK, true, 10, 5000)).toEqual({
      target: 110,
      at: 5000,
    });
  });

  it("CHAINS off the outstanding target, not the frozen clock", () => {
    // The v0.8.193 regression, stated as a test. `time` is frozen while a
    // hold is up, so a second press read the pre-burst position and aimed a
    // whole delta short of where mpv was going — a target that could never
    // be satisfied, so every burst ended in the 1.5s timeout and a snap.
    const first = nextHold(null, CLOCK, true, -10, 5000);
    const second = nextHold(first, CLOCK, true, -10, 5100);
    expect(second?.target).toBe(80);
    expect(second?.target).not.toBe(90); // aiming twice at the same place
  });

  it("clamps the way mpv clamps", () => {
    // Back-10 at 0:05 lands at 0:00, so aiming at -5 is aiming somewhere the
    // file does not go — and the hold would then never be satisfied.
    expect(nextHold(null, { pos: 5, dur: 9318.309 }, true, -10, 0)?.target).toBe(0);
    expect(
      nextHold(null, { pos: 9316, dur: 9318.309 }, true, 10, 0)?.target,
    ).toBeCloseTo(9318.309, 6);
  });

  it("arms nothing on an unseekable source", () => {
    // A doomed seek has to be visibly wrong at once, not 1.5s later.
    expect(nextHold(null, CLOCK, false, 10, 0)).toBeNull();
  });

  it("arms nothing on live, which has no clock and no scrubber", () => {
    expect(nextHold(null, null, true, 10, 0)).toBeNull();
  });

  it("re-stamps `at` so a held key keeps holding", () => {
    const first = nextHold(null, CLOCK, true, 10, 5000);
    expect(nextHold(first, CLOCK, true, 10, 5150)?.at).toBe(5150);
  });
});

describe("nextHoldAbs", () => {
  it("takes the target as stated, without chaining", () => {
    const cur = { target: 80, at: 1 };
    expect(nextHoldAbs(CLOCK, true, 4000, 5000)).toEqual({
      target: 4000,
      at: 5000,
    });
    // The outstanding hold is irrelevant to an absolute seek.
    expect(nextHoldAbs(CLOCK, true, 4000, 5000)?.target).toBe(4000);
    expect(cur.target).toBe(80);
  });

  it("clamps to the file and refuses the same cases", () => {
    expect(nextHoldAbs(CLOCK, true, -30, 0)?.target).toBe(0);
    expect(nextHoldAbs(CLOCK, true, 99_999, 0)?.target).toBeCloseTo(9318.309, 6);
    expect(nextHoldAbs(CLOCK, false, 4000, 0)).toBeNull();
    expect(nextHoldAbs(null, true, 4000, 0)).toBeNull();
  });
});
