import { describe, expect, it } from "vitest";
import { formatClock } from "./time";

describe("formatClock", () => {
  it("formats 12h like the design header", () => {
    expect(formatClock(new Date(2026, 0, 1, 20, 38))).toBe("8:38 PM");
  });

  it("keeps 12-hour edges sane", () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 5))).toBe("12:05 AM");
    expect(formatClock(new Date(2026, 0, 1, 12, 0))).toBe("12:00 PM");
  });

  it("formats 24h with leading zeros", () => {
    expect(formatClock(new Date(2026, 0, 1, 20, 38), "24h")).toBe("20:38");
    expect(formatClock(new Date(2026, 0, 1, 0, 5), "24h")).toBe("00:05");
  });
});
