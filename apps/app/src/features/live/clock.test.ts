import { describe, expect, it } from "vitest";
import { projectPos } from "./clock";

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

  it("clamps at the end of the file", () => {
    // Position stops at EOF while wall clock keeps going; an unclamped
    // projection would run the readout past the length of the film.
    expect(projectPos(DUR - 0.2, 1000, 60_000, 1, DUR)).toBe(DUR);
  });

  it("never goes negative", () => {
    expect(projectPos(0, 1000, 1000, 1, DUR)).toBe(0);
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
});
