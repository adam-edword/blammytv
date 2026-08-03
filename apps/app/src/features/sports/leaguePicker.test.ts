import { describe, expect, it } from "vitest";
import { ALL_LEAGUES, league, searchLeagues } from "./leagues";
import { toggleLeague } from "./follows";

/**
 * The picker's own logic, which is the SPLIT rather than the rendering:
 * favourites up top, everything else below, both filtered by one search.
 *
 * The component does this in two memos. These pin the rules those memos
 * encode, because the failure they guard against is silent: a league that
 * appears in both halves, or in neither, looks like a data problem rather
 * than a bug in a filter.
 */

/** The two lists the picker draws, exactly as it derives them. */
const split = (favourites: string[], query: string) => {
  const hits = searchLeagues(query);
  const matched = new Set(hits.map((l) => l.path));
  return {
    top: favourites
      .map(league)
      .filter((l) => l !== undefined)
      .filter((l) => matched.has(l.path)),
    rest: hits.filter((l) => !favourites.includes(l.path)),
  };
};

describe("the two halves never overlap and never lose anyone", () => {
  it("puts every league in exactly one half", () => {
    const favs = ["football/nfl", "baseball/mlb", "racing/f1"];
    const { top, rest } = split(favs, "");
    expect(top).toHaveLength(3);
    expect(top.length + rest.length).toBe(ALL_LEAGUES.length);
    const overlap = rest.filter((l) => favs.includes(l.path));
    expect(overlap).toEqual([]);
  });

  it("keeps favourites in the order they were added, not alphabetical", () => {
    // The store appends, so the newest lands at the end where it can be
    // seen arriving. Sorting would move it somewhere unpredictable.
    const { top } = split(["racing/f1", "football/nfl", "baseball/mlb"], "");
    expect(top.map((l) => l.path)).toEqual([
      "racing/f1",
      "football/nfl",
      "baseball/mlb",
    ]);
  });

  it("drops a favourite the catalog no longer carries", () => {
    // Same rule the board applies: a regeneration can retire a league, and
    // a dead path must not render as a blank tile.
    const { top } = split(["football/nfl", "sport/gone"], "");
    expect(top.map((l) => l.path)).toEqual(["football/nfl"]);
  });
});

describe("search filters BOTH halves, which is the whole point", () => {
  it("keeps a matching favourite up top and puts the rest below", () => {
    // Adam's example. A search that emptied the grid while filling the
    // column would read as "you follow no hockey" with the answer on
    // screen two rows up.
    const { top, rest } = split(["hockey/nhl", "football/nfl"], "hockey");
    expect(top.map((l) => l.path)).toEqual(["hockey/nhl"]);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((l) => l.path.startsWith("hockey/"))).toBe(true);
    // The NFL is a favourite and is not hockey, so it is in neither.
    expect(top.some((l) => l.path === "football/nfl")).toBe(false);
    expect(rest.some((l) => l.path === "football/nfl")).toBe(false);
  });

  it("can empty the top half without emptying the bottom", () => {
    const { top, rest } = split(["football/nfl"], "hockey");
    expect(top).toEqual([]);
    expect(rest.length).toBeGreaterThan(0);
  });
});

describe("favouriting from either half", () => {
  it("moves a league from the column to the grid, and back", () => {
    const none = { leagues: [], teams: [] };
    expect(split(none.leagues, "").top).toEqual([]);

    const one = toggleLeague(none, "hockey/nhl");
    expect(split(one.leagues, "").top.map((l) => l.path)).toEqual([
      "hockey/nhl",
    ]);
    expect(split(one.leagues, "").rest.some((l) => l.path === "hockey/nhl")).toBe(
      false,
    );

    const off = toggleLeague(one, "hockey/nhl");
    expect(split(off.leagues, "").top).toEqual([]);
    expect(split(off.leagues, "").rest.some((l) => l.path === "hockey/nhl")).toBe(
      true,
    );
  });
});
