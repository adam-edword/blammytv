import { describe, expect, it } from "vitest";
import {
  artCatalogFor,
  catalogExtra,
  pickSearchCatalogs,
  gridCatalogs,
  interleave,
  pickCatalogs,
  servesGenre,
  unionGenres,
} from "./data";

describe("pickCatalogs", () => {
  it("keeps EVERY browseable movie/series catalog, skipping required-extra ones", () => {
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
      { type: "movie", id: "second-movies" }, // browseable → kept too
      { type: "series", id: "top-series" }, // no extra at all is fine
      { type: "tv", id: "live-tv" }, // unknown type → ignored
    ]);
    expect(out).toEqual([
      {
        type: "movie",
        id: "top-movies",
        genreCapable: true,
        genres: ["Action", "Drama"],
      },
      { type: "movie", id: "second-movies", genreCapable: false, genres: [] },
      { type: "series", id: "top-series", genreCapable: false, genres: [] },
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

describe("pickSearchCatalogs", () => {
  it("keeps every catalog with a search extra, required or optional", () => {
    const out = pickSearchCatalogs([
      { type: "movie", id: "search", extra: [{ name: "search", isRequired: true }] },
      { type: "movie", id: "top", extra: [{ name: "genre" }, { name: "search" }] },
      { type: "movie", id: "plain" },
      { type: "tv", id: "live", extra: [{ name: "search" }] },
    ]);
    expect(out.map((c) => c.id)).toEqual(["search", "top"]);
  });
});

describe("gridCatalogs", () => {
  const cats = [
    {
      type: "movie" as const,
      id: "anime-movies",
      genreCapable: true,
      genres: ["Action", "Anime"],
    },
    {
      type: "movie" as const,
      id: "top-movies",
      genreCapable: true,
      genres: ["Action", "Crime"],
    },
    {
      type: "series" as const,
      id: "top-series",
      genreCapable: true,
      genres: ["Crime"],
    },
  ];

  it("returns every catalog matching type + genre (the conglomerate)", () => {
    expect(gridCatalogs(cats, "all", null).map((c) => c.id)).toEqual([
      "anime-movies",
      "top-movies",
      "top-series",
    ]);
    expect(gridCatalogs(cats, "movie", null).map((c) => c.id)).toEqual([
      "anime-movies",
      "top-movies",
    ]);
  });

  it("a genre only some catalogs declare narrows to those", () => {
    expect(gridCatalogs(cats, "all", "Crime").map((c) => c.id)).toEqual([
      "top-movies",
      "top-series",
    ]);
    expect(gridCatalogs(cats, "series", "Anime")).toEqual([]);
  });
});

describe("unionGenres", () => {
  it("keeps movie order first and dedupes case-insensitively", () => {
    const out = unionGenres([
      {
        type: "movie",
        id: "m",
        genreCapable: true,
        genres: ["Action", "Sci-Fi", "Drama"],
      },
      {
        type: "series",
        id: "s",
        genreCapable: true,
        genres: ["drama", "Anime", " Action "],
      },
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
  const cat = {
    type: "movie" as const,
    id: "m",
    genreCapable: true,
    genres: ["Action", "Drama"],
  };
  it("matches case-insensitively and always serves the null filter", () => {
    expect(servesGenre(cat, null)).toBe(true);
    expect(servesGenre(cat, "action")).toBe(true);
    expect(servesGenre(cat, "Anime")).toBe(false);
  });

  it("genre extra without options serves ANY genre; no extra serves none", () => {
    // The real-manifest bug: 8 of 10 catalogs declared genre without
    // enumerating options and were silently benched from the rail.
    expect(servesGenre({ ...cat, genres: [] }, "Action")).toBe(true);
    expect(
      servesGenre({ ...cat, genreCapable: false, genres: [] }, "Action"),
    ).toBe(false);
  });
});

describe("artCatalogFor", () => {
  const serving = ["a", "b", "c"].map((id) => ({
    type: "movie" as const,
    id,
    genreCapable: true,
    genres: [],
  }));

  it("rotates through every serving catalog as deals advance", () => {
    const seq = [0, 1, 2, 3].map((n) => artCatalogFor(serving, "Action", n).id);
    expect(new Set(seq.slice(0, 3)).size).toBe(3); // all three, in some order
    expect(seq[3]).toBe(seq[0]); // wraps
  });

  it("staggers different genres to different starting catalogs", () => {
    const starts = new Set(
      ["Action", "Comedy", "Drama", "Crime", "Family", "History"].map(
        (g) => artCatalogFor(serving, g, 0).id,
      ),
    );
    expect(starts.size).toBeGreaterThan(1); // not everyone starts at "a"
  });
});

describe("interleave", () => {
  it("alternates and drains the longer tail", () => {
    expect(interleave([1, 3, 5, 7], [2, 4])).toEqual([1, 2, 3, 4, 5, 7]);
    expect(interleave([], [1, 2])).toEqual([1, 2]);
    expect(interleave([1], [])).toEqual([1]);
  });

  it("round-robins any number of feeds", () => {
    expect(interleave(["a1", "a2"], ["b1"], ["c1", "c2", "c3"])).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
      "c2",
      "c3",
    ]);
    expect(interleave<number>()).toEqual([]);
  });
});
