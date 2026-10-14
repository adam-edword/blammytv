import { describe, expect, it } from "vitest";
import { episodeKey, imdbOf, jellyfinIdOfKey, opaqueId, refOf, titleKey, type SeriesKeyOf } from "./ids";
import { EP1, EP3, FIX, SEVERANCE, ZZZ, ZZZ_EP, item } from "./fixture";

describe("a title's key", () => {
  it("is its IMDb id when the server matched one", () => {
    expect(titleKey(item(SEVERANCE))).toBe("tt11280740");
    expect(titleKey(item(FIX.movieId))).toBe("tt2043923");
  });

  it("is jf:<its own id> when nothing matched", () => {
    expect(titleKey(item(ZZZ))).toBe(`jf:${ZZZ}`);
  });

  it("ignores TMDB and TVDB ids, which nothing downstream reads", () => {
    const s = { ...item(SEVERANCE), ProviderIds: { Tmdb: "95396", Tvdb: "371980" } };
    expect(titleKey(s)).toBe(`jf:${SEVERANCE}`);
  });

  it("is null for anything but a film or a show, or without a usable id", () => {
    expect(titleKey(item(EP1))).toBeNull();
    expect(titleKey(FIX.views[0])).toBeNull();
    expect(titleKey({ Type: "Movie", Id: "nope", ProviderIds: {} })).toBeNull();
    expect(titleKey({ Type: "Movie", ProviderIds: {} })).toBeNull();
  });

  it("does not take an IMDb id that is not one", () => {
    expect(imdbOf({ ProviderIds: { Imdb: "11280740" } })).toBeNull();
    expect(imdbOf({ ProviderIds: { Imdb: "tt1; DROP" } })).toBeNull();
    expect(imdbOf({})).toBeNull();
  });
});

describe("jf: keys", () => {
  it("carry the item id and give it back", () => {
    expect(opaqueId(ZZZ)).toBe(`jf:${ZZZ}`);
    expect(jellyfinIdOfKey(`jf:${ZZZ}`)).toBe(ZZZ);
  });
  it("never decode into anything but 32 lower case hex", () => {
    expect(opaqueId("ABC")).toBeNull();
    expect(opaqueId(undefined)).toBeNull();
    expect(jellyfinIdOfKey("tt11280740")).toBeNull();
    expect(jellyfinIdOfKey("jf:../../etc")).toBeNull();
    expect(jellyfinIdOfKey(`jf:${ZZZ.toUpperCase()}`)).toBeNull();
  });
});

describe("an episode's key", () => {
  it("is the SHOW's IMDb id and the numbers, never the episode's own IMDb id", () => {
    expect(item(EP1).ProviderIds?.Imdb).toBe("tt11650328");
    expect(episodeKey(item(EP1), "tt11280740")).toBe("tt11280740:1:1");
    expect(episodeKey(item(EP3), "tt11280740")).toBe("tt11280740:1:3");
  });
  it("is the episode's own jf: id under a show that has no IMDb id", () => {
    expect(episodeKey(item(ZZZ_EP), `jf:${ZZZ}`)).toBe(`jf:${ZZZ_EP}`);
  });
  it("keeps season 0 (specials) and refuses an episode without its numbers", () => {
    expect(episodeKey({ Id: EP1, ParentIndexNumber: 0, IndexNumber: 4 }, "tt1")).toBe("tt1:0:4");
    expect(episodeKey({ Id: EP1, IndexNumber: 4 }, "tt1")).toBeNull();
    expect(episodeKey({ Id: EP1, ParentIndexNumber: 1 }, "tt1")).toBeNull();
    expect(episodeKey({ Id: EP1, ParentIndexNumber: -1, IndexNumber: 1 }, "tt1")).toBeNull();
  });
});

describe("refOf", () => {
  const known: SeriesKeyOf = (id) => (id === SEVERANCE ? "tt11280740" : id === ZZZ ? `jf:${ZZZ}` : undefined);

  it("reads a film and a show", () => {
    expect(refOf(item(FIX.movieId), known)).toEqual({ id: "tt2043923", kind: "movie" });
    expect(refOf(item(SEVERANCE), known)).toEqual({ id: "tt11280740", kind: "series" });
  });

  it("reads an episode under its show's key, which is also its title id", () => {
    expect(refOf(item(EP3), known)).toEqual({
      id: "tt11280740",
      kind: "episode",
      episodeId: "tt11280740:1:3",
      seriesId: "tt11280740",
      season: 1,
      episode: 3,
    });
    expect(refOf(item(ZZZ_EP), known)).toMatchObject({ id: `jf:${ZZZ}`, episodeId: `jf:${ZZZ_EP}` });
  });

  it("is null for an episode whose show has not been read, and never guesses it", () => {
    expect(refOf(item(EP3), () => undefined)).toBeNull();
    // The show IS a titled one, so a jf: key from the episode alone would split its watched state.
    expect(refOf(item(EP3), () => null)).toBeNull();
  });

  it("is null for a season, a folder, a view and an item without a usable id", () => {
    const season = Object.values(FIX.items).find((i) => i.Type === "Season") as object;
    expect(refOf(season, known)).toBeNull();
    expect(refOf(FIX.junk[0], known)).toBeNull();
    expect(refOf(FIX.views[0], known)).toBeNull();
    expect(refOf({ Type: "Movie", Id: "x" }, known)).toBeNull();
    expect(refOf({ Type: "Episode", Id: EP1, SeriesId: "x", ParentIndexNumber: 1, IndexNumber: 1 }, known)).toBeNull();
  });
});
