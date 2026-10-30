import { describe, expect, it } from "vitest";
import { shapeTrakt } from "./traktRows";

const movie = (title: string, year: number | null, imdb: string | null) => ({ title, year, ids: { trakt: 1, imdb } });

describe("shapeTrakt", () => {
  it("reads trending movies, which Trakt wraps: a film with its id, title, kind and year, in Trakt's order", () => {
    const got = shapeTrakt("trending_movies", [
      { watchers: 90, movie: movie("Alpha", 2024, "tt0000001") },
      { watchers: 40, movie: movie("Beta", 2023, "tt0000002") },
    ]);
    expect(got).toEqual([
      { id: "tt0000001", title: "Alpha", kind: "movie", year: 2024, at: 0 },
      { id: "tt0000002", title: "Beta", kind: "movie", year: 2023, at: 0 },
    ]);
  });

  it("reads trending shows as series", () => {
    const got = shapeTrakt("trending_shows", [{ watchers: 5, show: movie("Gamma", 2022, "tt0000003") }]);
    expect(got).toEqual([{ id: "tt0000003", title: "Gamma", kind: "series", year: 2022, at: 0 }]);
  });

  it("reads popular lists, which Trakt sends bare", () => {
    expect(shapeTrakt("popular_movies", [movie("Delta", 2001, "tt0000004")])).toEqual([
      { id: "tt0000004", title: "Delta", kind: "movie", year: 2001, at: 0 },
    ]);
    expect(shapeTrakt("popular_shows", [movie("Epsilon", 1999, "tt0000005")])[0]).toMatchObject({ kind: "series", id: "tt0000005" });
  });

  it("drops a title with no IMDb id, or one that is not an IMDb id, and a title seen twice", () => {
    const got = shapeTrakt("popular_movies", [
      movie("No Id", 2020, null),
      movie("Wrong Id", 2020, "12345"),
      movie("Once", 2020, "tt0000009"),
      movie("Twice", 2021, "tt0000009"),
    ]);
    expect(got.map((e) => e.title)).toEqual(["Once"]);
  });

  it("leaves the year off when Trakt has none, and names a title by its id when it has no name", () => {
    const got = shapeTrakt("popular_movies", [{ ids: { imdb: "tt0000010" } }, movie("Zeta", null, "tt0000011")]);
    expect(got).toEqual([
      { id: "tt0000010", title: "tt0000010", kind: "movie", at: 0 },
      { id: "tt0000011", title: "Zeta", kind: "movie", at: 0 },
    ]);
  });

  it("gives nothing for an answer that is not a list, and skips what is not a title", () => {
    expect(shapeTrakt("popular_movies", { error: "x" })).toEqual([]);
    expect(shapeTrakt("popular_movies", null)).toEqual([]);
    expect(shapeTrakt("popular_movies", [null, 4, "x", {}])).toEqual([]);
  });
});
