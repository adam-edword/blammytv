import { describe, expect, it } from "vitest";
import { toggleFavorite } from "./favorites";

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
