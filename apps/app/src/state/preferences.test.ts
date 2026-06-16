import { describe, it, expect } from "vitest";
import {
  hexToRgbTriplet,
  clampScale,
  nearestScaleIndex,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
} from "./preferences";

describe("hexToRgbTriplet", () => {
  it("converts a hex colour to an 'r g b' triplet", () => {
    expect(hexToRgbTriplet("#c22727")).toBe("194 39 39");
    expect(hexToRgbTriplet("#000000")).toBe("0 0 0");
    expect(hexToRgbTriplet("#ffffff")).toBe("255 255 255");
  });

  it("tolerates a missing # and surrounding space", () => {
    expect(hexToRgbTriplet("  c22727 ")).toBe("194 39 39");
  });

  it("falls back to the default accent on bad input", () => {
    expect(hexToRgbTriplet("nope")).toBe("194 39 39");
    expect(hexToRgbTriplet("#abc")).toBe("194 39 39");
  });
});

describe("clampScale", () => {
  it("clamps to the allowed range", () => {
    expect(clampScale(0.5)).toBe(UI_SCALE_MIN);
    expect(clampScale(2)).toBe(UI_SCALE_MAX);
    expect(clampScale(1)).toBe(1);
  });

  it("defaults NaN to 1", () => {
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe("nearestScaleIndex", () => {
  it("snaps to the closest notch", () => {
    expect(nearestScaleIndex(1)).toBe(2); // 100%
    expect(nearestScaleIndex(0.81)).toBe(0); // 80%
    expect(nearestScaleIndex(1.18)).toBe(4); // 120%
  });
});
