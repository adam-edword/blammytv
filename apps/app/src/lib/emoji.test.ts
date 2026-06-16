import { describe, it, expect } from "vitest";
import { extractEmoji } from "./emoji";

describe("extractEmoji", () => {
  it("pulls every emoji out, concatenated", () => {
    expect(extractEmoji("FIFA World Cup ⚽ 🏆")).toBe("⚽🏆");
  });

  it("returns an empty string when there's no emoji", () => {
    expect(extractEmoji("4K / UHD Channels")).toBe("");
  });

  it("handles a single trailing emoji", () => {
    expect(extractEmoji("NFL Game Pass 🏈")).toBe("🏈");
  });

  it("keeps a ZWJ sequence as one grapheme", () => {
    // Family emoji is a single ZWJ-joined glyph, not three.
    expect(extractEmoji("👨‍👩‍👧 family plan")).toBe("👨‍👩‍👧");
  });
});
