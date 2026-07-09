import { describe, expect, it } from "vitest";
import { reorderFavorite, toggleFavorite } from "./favorites";

describe("toggleFavorite", () => {
  it("adds an id that isn't starred yet (appended)", () => {
    expect(toggleFavorite(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that is already starred", () => {
    expect(toggleFavorite(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("round-trips back to the original", () => {
    const once = toggleFavorite([], "x");
    expect(once).toEqual(["x"]);
    expect(toggleFavorite(once, "x")).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const list = ["a"];
    toggleFavorite(list, "b");
    expect(list).toEqual(["a"]);
  });
});

describe("reorderFavorite", () => {
  it("moves an id forward to a new index", () => {
    expect(reorderFavorite(["a", "b", "c", "d"], "a", 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves an id backward", () => {
    expect(reorderFavorite(["a", "b", "c", "d"], "d", 0)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("clamps an over-long target to the end", () => {
    expect(reorderFavorite(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op for an id not in the list", () => {
    expect(reorderFavorite(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });

  it("does not mutate the input list", () => {
    const list = ["a", "b", "c"];
    reorderFavorite(list, "c", 0);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
