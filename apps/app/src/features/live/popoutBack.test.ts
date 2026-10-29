import { describe, expect, it } from "vitest";
import { resumesGuide } from "./popoutBack";

describe("what closing the pop-out brings back (plan 016 F11)", () => {
  it("starts the Guide's channel when the Guide opened the pop-out", () => {
    expect(resumesGuide("guide", "p1:7", null)).toBe(true);
  });

  it("does not, for a pop-out another screen opened or one that said nothing", () => {
    expect(resumesGuide("sports", "p1:7", null)).toBe(false);
    expect(resumesGuide(null, "p1:7", null)).toBe(false);
  });

  it("does not, with no channel to start", () => {
    expect(resumesGuide("guide", undefined, null)).toBe(false);
    expect(resumesGuide("guide", "", null)).toBe(false);
  });

  it("does not start the channel on top of a recording the player has open", () => {
    expect(resumesGuide("guide", "p1:7", "r1")).toBe(false);
  });
});
