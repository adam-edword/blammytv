import { describe, expect, it } from "vitest";
import {
  catalogExtra,
  interleave,
  pickCatalogs,
  servesGenre,
  unionGenres,
} from "./data";

describe("pickCatalogs", () => {
  it("takes the first browseable catalog per type, skipping required-extra ones", () => {
    const out = pickCatalogs([
      // search-only: required extra → never browseable
      {
        type: "movie",
        id: "search",
        extra: [{ name: "search", isRequired: true }],
      },
      {
        type: "movie",
        id: "top-movies",
        extra: [{ name: "genre", options: ["Action", "Drama"] }],
      },
      { type: "movie", id: "second-movies" }, // not first → ignored
      { type: "series", id: "top-series" }, // no extra at all is fine
      { type: "tv", id: "live-tv" }, // unknown type → ignored
    ]);
    expect(out).toEqual([
      { type: "movie", id: "top-movies", genres: ["Action", "Drama"] },
      { type: "series", id: "top-series", genres: [] },
    ]);
  });

  it("returns empty when nothing is browseable", () => {
    expect(
      pickCatalogs([
        {
          type: "movie",
          id: "s",
          extra: [{ name: "search", isRequired: true }],
        },
      ]),
    ).toEqual([]);
  });
});

describe("unionGenres", () => {
  it("keeps movie order first and dedupes case-insensitively", () => {
    const out = unionGenres([
      { type: "movie", id: "m", genres: ["Action", "Sci-Fi", "Drama"] },
      { type: "series", id: "s", genres: ["drama", "Anime", " Action "] },
    ]);
    expect(out).toEqual(["Action", "Sci-Fi", "Drama", "Anime"]);
  });
});

describe("catalogExtra", () => {
  it("composes genre and skip into one extra segment", () => {
    expect(catalogExtra(null, 0)).toBeUndefined();
    expect(catalogExtra("Action", 0)).toBe("genre=Action");
    expect(catalogExtra(null, 100)).toBe("skip=100");
    expect(catalogExtra("Sci-Fi & Fantasy", 200)).toBe(
      "genre=Sci-Fi%20%26%20Fantasy&skip=200",
    );
  });
});

describe("servesGenre", () => {
  const cat = { type: "movie" as const, id: "m", genres: ["Action", "Drama"] };
  it("matches case-insensitively and always serves the null filter", () => {
    expect(servesGenre(cat, null)).toBe(true);
    expect(servesGenre(cat, "action")).toBe(true);
    expect(servesGenre(cat, "Anime")).toBe(false);
    // A catalog with no declared genres can't be filtered at all.
    expect(servesGenre({ ...cat, genres: [] }, "Action")).toBe(false);
  });
});

describe("interleave", () => {
  it("alternates and drains the longer tail", () => {
    expect(interleave([1, 3, 5, 7], [2, 4])).toEqual([1, 2, 3, 4, 5, 7]);
    expect(interleave([], [1, 2])).toEqual([1, 2]);
    expect(interleave([1], [])).toEqual([1]);
  });
});
