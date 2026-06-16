import { describe, it, expect } from "vitest";
import {
  ShareCodeSchema,
  normalizeShareCodeInput,
  isCompleteShareCode,
} from "@blammytv/shared";

describe("ShareCodeSchema", () => {
  it("accepts a valid 6-char code", () => {
    expect(ShareCodeSchema.safeParse("ABCD23").success).toBe(true);
  });

  it("trims and upper-cases", () => {
    expect(ShareCodeSchema.parse("  abcd23 ")).toBe("ABCD23");
  });

  it("rejects ambiguous glyphs (0/O, 1/I)", () => {
    expect(ShareCodeSchema.safeParse("AB0D23").success).toBe(false); // zero
    expect(ShareCodeSchema.safeParse("ABODE2").success).toBe(false); // letter O
    expect(ShareCodeSchema.safeParse("AB1D23").success).toBe(false); // one
    expect(ShareCodeSchema.safeParse("ABID23").success).toBe(false); // letter I
  });

  it("rejects the wrong length", () => {
    expect(ShareCodeSchema.safeParse("ABCDE").success).toBe(false);
    expect(ShareCodeSchema.safeParse("ABCDEFG").success).toBe(false);
  });
});

describe("normalizeShareCodeInput", () => {
  it("upper-cases, drops invalid characters, and caps at 6", () => {
    expect(normalizeShareCodeInput("a1b o2cd9")).toBe("AB2CD9");
  });

  it("drops excluded letters and caps length", () => {
    // I is excluded; result is capped to 6 chars.
    expect(normalizeShareCodeInput("abcdefghij")).toBe("ABCDEF");
  });
});

describe("isCompleteShareCode", () => {
  it("is true only for a full valid code", () => {
    expect(isCompleteShareCode("ABCD23")).toBe(true);
    expect(isCompleteShareCode("ABC")).toBe(false);
    expect(isCompleteShareCode("")).toBe(false);
  });
});
