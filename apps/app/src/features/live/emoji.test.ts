import { describe, expect, it } from "vitest";
import { splitTitleEmoji } from "./emoji";

describe("splitTitleEmoji", () => {
  it("lifts a leading emoji out of the title", () => {
    expect(splitTitleEmoji("⚽ Football")).toEqual({
      emoji: "⚽",
      label: "Football",
    });
  });

  it("keeps flag pairs whole", () => {
    expect(splitTitleEmoji("🇺🇸 United States")).toEqual({
      emoji: "🇺🇸",
      label: "United States",
    });
  });

  it("keeps ZWJ sequences whole", () => {
    expect(splitTitleEmoji("👨‍👩‍👧 Family")).toEqual({
      emoji: "👨‍👩‍👧",
      label: "Family",
    });
  });

  it("cleans separators stranded by a leading emoji", () => {
    expect(splitTitleEmoji("⚽ | FOOTBALL")).toEqual({
      emoji: "⚽",
      label: "FOOTBALL",
    });
  });

  it("pulls an emoji from mid-title without mangling the rest", () => {
    expect(splitTitleEmoji("US | 🏈 NFL")).toEqual({
      emoji: "🏈",
      label: "US | NFL",
    });
  });

  it("returns null for plain titles", () => {
    expect(splitTitleEmoji("Premier League 2023-24")).toEqual({
      emoji: null,
      label: "Premier League 2023-24",
    });
  });

  it("ignores text-presentation symbols", () => {
    expect(splitTitleEmoji("Fire™ Channel")).toEqual({
      emoji: null,
      label: "Fire™ Channel",
    });
  });

  it("honors an explicit variation selector", () => {
    expect(splitTitleEmoji("☀️ Daytime")).toEqual({
      emoji: "☀️",
      label: "Daytime",
    });
  });

  it("keeps an emoji-only title as its own label", () => {
    expect(splitTitleEmoji("🔥")).toEqual({ emoji: "🔥", label: "🔥" });
  });
});
