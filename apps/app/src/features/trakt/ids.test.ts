import { describe, expect, it } from "vitest";
import { episodeId, episodeRef, imdbOf } from "./ids";

describe("Trakt ids (plan 015)", () => {
  it("an IMDb id is one", () => {
    expect(imdbOf("tt0903747")).toBe("tt0903747");
  });

  it("a title keyed by anything else does not sync (D5)", () => {
    expect(imdbOf("kitsu:1376")).toBeNull();
    expect(imdbOf("tmdb:1396")).toBeNull();
    expect(imdbOf("tt0903747:1:2")).toBeNull();
  });

  it("an episode id comes apart into show, season and number", () => {
    expect(episodeRef("tt0903747:5:14")).toEqual({ show: "tt0903747", season: 5, number: 14 });
    expect(episodeRef("tt0903747:0:3")).toEqual({ show: "tt0903747", season: 0, number: 3 });
  });

  it("an episode not keyed by IMDb is null", () => {
    expect(episodeRef("kitsu:1376:5")).toBeNull();
    expect(episodeRef("tt0903747")).toBeNull();
  });

  it("and goes back together", () => {
    expect(episodeId("tt0903747", 5, 14)).toBe("tt0903747:5:14");
  });
});
