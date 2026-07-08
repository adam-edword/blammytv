import { describe, expect, it } from "vitest";
import { recordRecent } from "./recents";

describe("recordRecent", () => {
  it("puts a new id at the front, most-recent-first", () => {
    expect(recordRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("moves an already-present id to the front (no duplicates)", () => {
    expect(recordRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(recordRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("caps the list at 30, dropping the oldest", () => {
    const many = Array.from({ length: 30 }, (_, i) => `ch${i}`);
    const next = recordRecent(many, "new");
    expect(next).toHaveLength(30);
    expect(next[0]).toBe("new");
    // ch29 was last; adding a 31st entry drops it.
    expect(next).not.toContain("ch29");
  });

  it("does not mutate the input list", () => {
    const list = ["a", "b"];
    recordRecent(list, "c");
    expect(list).toEqual(["a", "b"]);
  });
});
