import { describe, expect, it } from "vitest";
import { bands } from "./mvLevel";

describe("bands", () => {
  it("is flat for silence", () => {
    expect(bands(new Uint8Array(128))).toEqual([0, 0, 0]);
  });

  it("puts a low hum in the first bar and a hiss in the last", () => {
    const hum = new Uint8Array(128);
    hum.fill(255, 1, 4);
    const [low, mid, high] = bands(hum);
    expect(low).toBeCloseTo(1);
    expect(mid).toBe(0);
    expect(high).toBe(0);
    const hiss = new Uint8Array(128);
    hiss.fill(255, 16, 60);
    expect(bands(hiss)[2]).toBeCloseTo(1);
    expect(bands(hiss)[0]).toBe(0);
  });

  it("lifts quiet sound so speech still moves the bars", () => {
    const quiet = new Uint8Array(128).fill(64);
    // a quarter of full scale reads as half, not a quarter
    expect(bands(quiet)[1]).toBeCloseTo(Math.sqrt(64 / 255));
  });
});
