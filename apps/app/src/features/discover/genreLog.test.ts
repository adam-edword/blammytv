import { describe, expect, it } from "vitest";
import type { VodItem } from "../stream/model";
import type { DiscoverCatalog } from "./data";
import { gridLog, logGridPage, logGridReset, logGridShown } from "./genreLog";

const item = (id: string, genres: string[]): VodItem =>
  ({ id, title: id.toUpperCase(), kind: "movie", genres, cast: [], seasons: [] }) as VodItem;
const top: DiscoverCatalog = { type: "movie", id: "top", genreCapable: true, genres: ["Comedy", "Drama"] };
const any: DiscoverCatalog = { type: "movie", id: "list", genreCapable: true, genres: [] };

describe("genreLog", () => {
  it("says where each card came from, what each catalog declares, and how much of it carries the genre", () => {
    logGridReset("Comedy");
    const a = item("a", ["Comedy"]);
    const b = item("b", ["Crime", "Drama"]);
    logGridPage(top, 0, [a]);
    logGridPage(any, 20, [b, a]);
    logGridShown([a, b]);
    const log = gridLog();
    expect(log.genre).toBe("Comedy");
    expect(log.cards.map((c) => [c.title, c.from])).toEqual([
      ["A", ["movie:top#1", "movie:list#22"]],
      ["B", ["movie:list#21"]],
    ]);
    expect(log.catalogs["movie:top"]).toEqual({ declares: "2 genres", pages: 1, got: 1, tagged: 1 });
    expect(log.catalogs["movie:list"]).toEqual({ declares: "any genre", pages: 1, got: 2, tagged: 1 });
  });

  it("starts over on a reset", () => {
    logGridReset(null);
    expect(gridLog()).toEqual({ genre: null, catalogs: {}, cards: [] });
  });
});
