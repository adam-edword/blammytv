import { describe, expect, it } from "vitest";
import { calendarDay, formatClock, formatWhen } from "./time";

describe("calendarDay", () => {
  /** A local date as numbers, and its hour, which must be midnight. */
  const at = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];

  it("takes ESPN golf's midnight Eastern as that day, summer and winter", () => {
    expect(at(calendarDay("2026-08-06T04:00Z"))).toEqual([2026, 8, 6, 0]);
    expect(at(calendarDay("2026-01-08T05:00Z"))).toEqual([2026, 1, 8, 0]);
  });

  it("takes an addon's release date as that day, Cinemeta's 05:00 or 00:00 UTC", () => {
    expect(at(calendarDay("2008-01-21T05:00:00.000Z"))).toEqual([2008, 1, 21, 0]);
    expect(at(calendarDay("2024-01-01T00:00:00Z"))).toEqual([2024, 1, 1, 0]);
    expect(at(calendarDay("2024-01-01"))).toEqual([2024, 1, 1, 0]);
  });

  it("gives an Invalid Date for what isn't one, as new Date does", () => {
    expect(Number.isNaN(calendarDay("soon").getTime())).toBe(true);
  });
});

describe("formatClock", () => {
  it("says nothing for an invalid date instead of throwing", () => {
    expect(formatClock(new Date(Number.NaN))).toBe("");
  });

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

describe("formatWhen", () => {
  const now = new Date(2026, 9, 10, 15, 0);

  it("is just the time today", () => {
    expect(formatWhen(new Date(2026, 9, 10, 9, 14), now)).toBe("9:14 AM");
    expect(formatWhen(new Date(2026, 9, 10, 21, 14), now, "24h")).toBe("21:14");
  });

  it("names the day for any other", () => {
    expect(formatWhen(new Date(2026, 9, 9, 21, 14), now)).toBe("Oct 9, 9:14 PM");
    expect(formatWhen(new Date(2026, 9, 9, 21, 14), now, "24h")).toBe("Oct 9, 21:14");
    // Same day of the month, another month and year: not today.
    expect(formatWhen(new Date(2025, 9, 10, 9, 14), now)).toBe("Oct 10, 9:14 AM");
  });

  it("says nothing for an invalid date", () => {
    expect(formatWhen(new Date(Number.NaN), now)).toBe("");
  });
});
