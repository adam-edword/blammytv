import { describe, expect, it } from "vitest";
import { ago } from "./account";

describe("ago", () => {
  const now = Date.UTC(2026, 8, 27, 12);
  it.each([
    [10_000, "just now"],
    [60_000, "a minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [60 * 60_000, "an hour ago"],
    [3 * 3600_000, "3 hours ago"],
    [24 * 3600_000, "yesterday"],
    [4 * 86_400_000, "4 days ago"],
  ])("%i ms back reads %s", (back, want) => {
    expect(ago(now - back, now)).toBe(want);
  });
});
