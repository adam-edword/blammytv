import { describe, expect, it } from "vitest";
import { foldReading, type LineReading } from "./connections";

describe("foldReading", () => {
  const read = (active: number, max: number, at: number): LineReading => ({ active, max, at });
  const start = new Map([["t", read(3, 3, 1000)]]);

  it("takes a new count, with when it was read", () => {
    expect(foldReading(start, "t", { active: 2, max: 3 }, 5000).get("t")).toEqual(read(2, 3, 5000));
  });
  it("keeps the last count through a failed poll (plan 018, L1)", () => {
    expect(foldReading(start, "t", "failed", 5000)).toBe(start);
  });
  it("drops the count when the panel reports no limit", () => {
    expect(foldReading(start, "t", null, 5000).has("t")).toBe(false);
  });
});
