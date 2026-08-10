import { describe, expect, it } from "vitest";
import { HOLD_MS, HOLD_TOL, holdsPoll, type SeekHold } from "./seekHold";

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

  it("allows for the clock having moved on since the seek landed", () => {
    // Playback resumes the moment the seek completes, so the first poll to
    // observe it reads slightly past the target. That is arrival, not drift.
    expect(holdsPoll(hold, 4000 + HOLD_TOL - 0.1, at + 400)).toBe(false);
    expect(holdsPoll(hold, 4000 + HOLD_TOL + 0.1, at + 400)).toBe(true);
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
