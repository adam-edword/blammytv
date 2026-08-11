import { describe, expect, it } from "vitest";
import { CLOCK_TICK_MS, projectPos } from "./clock";

const DUR = 9318.309; // the real remux the player work was measured against

describe("projectPos", () => {
  it("returns the anchor at the moment it was taken", () => {
    expect(projectPos(100, 1000, 1000, 1, DUR)).toBe(100);
  });

  it("advances one second per second at 1x", () => {
    expect(projectPos(100, 1000, 1500, 1, DUR)).toBeCloseTo(100.5, 6);
    expect(projectPos(100, 1000, 2000, 1, DUR)).toBeCloseTo(101, 6);
  });

  it("follows the playback rate", () => {
    expect(projectPos(100, 1000, 2000, 2, DUR)).toBeCloseTo(102, 6);
    expect(projectPos(100, 1000, 2000, 0.5, DUR)).toBeCloseTo(100.5, 6);
  });

  it("stands still at speed 0", () => {
    // Not reachable through the UI (the menu's slowest is 0.25) but the
    // caller gates on `speed > 0` and this is the other half of that pact.
    expect(projectPos(100, 1000, 60_000, 0, DUR)).toBe(100);
  });

  it("clamps at the end of the file", () => {
    // Position stops at EOF while wall clock keeps going; an unclamped
    // projection would run the readout past the length of the film.
    expect(projectPos(DUR - 0.2, 1000, 60_000, 1, DUR)).toBe(DUR);
  });

  it("floors a negative anchor at zero", () => {
    // The earlier version of this test passed anchorPos 0 with zero elapsed,
    // so the guard it claimed to cover was unreachable and deleting the
    // guard kept all 676 tests green. Only a negative anchor exercises it.
    expect(projectPos(-5, 1000, 1000, 1, DUR)).toBe(0);
    expect(projectPos(-5, 1000, 3000, 1, DUR)).toBe(0);
  });

  it("ignores a clock that went backwards", () => {
    // performance.now() is monotonic, but an anchor taken a hair in the
    // future (same-tick ordering) must not rewind the readout.
    expect(projectPos(100, 2000, 1000, 1, DUR)).toBe(100);
  });

  it("does not accumulate: a fresh anchor overrides the old projection", () => {
    // The whole safety property. Whatever we projected, mpv's next reading
    // replaces it outright, so a seek lands at once and drift cannot build.
    const drifted = projectPos(100, 1000, 5000, 1, DUR);
    expect(drifted).toBeCloseTo(104, 6);
    expect(projectPos(50, 5000, 5000, 1, DUR)).toBe(50);
  });

  it("collapses to 0:00 on a durationless file, which the caller must prevent", () => {
    // Documented so the invariant is visible from BOTH sides: TheaterOverlay
    // only runs the projection when `time` exists, and useDirectOverlay only
    // builds `time` when mpv reports dur > 0. If either drifts, the readout
    // freezes at zero rather than doing something obviously broken.
    expect(projectPos(100, 1000, 5000, 1, 0)).toBe(0);
  });

  it("pins the tick rate", () => {
    // A literal, not a re-export: raising this is a deliberate act, and it
    // trades DOM writes against how late the second flips.
    expect(CLOCK_TICK_MS).toBe(100);
  });
});
