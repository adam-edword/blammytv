import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, isValidHex } from "./accent";

describe("accent", () => {
  it("validates six-digit hex colors only", () => {
    expect(isValidHex("#c22727")).toBe(true);
    expect(isValidHex("#FFD500")).toBe(true);
    expect(isValidHex("#fff")).toBe(false);
    expect(isValidHex("c22727")).toBe(false);
    expect(isValidHex("#c2272g")).toBe(false);
  });

  it("ships valid presets", () => {
    for (const preset of ACCENT_PRESETS) {
      expect(isValidHex(preset.hex)).toBe(true);
    }
  });
});
