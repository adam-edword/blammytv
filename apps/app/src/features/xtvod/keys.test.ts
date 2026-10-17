import { describe, expect, it } from "vitest";
import { episodeKey, readKey, titleKey, titleOf } from "./keys";

const UUID = "3f2b8c1e-5d4a-4c7e-9b0a-1e2d3c4b5a69";

describe("a title's key", () => {
  it("is filed by its TMDB id when it has one, and by the panel's id when it does not", () => {
    expect(titleKey("t", "movie", { id: "52114", tmdb: 617126 })).toBe("xt:t:m:t617126");
    expect(titleKey("t", "movie", { id: "52114" })).toBe("xt:t:m:52114");
    expect(titleKey("t", "series", { id: "3101", tmdb: 4521 })).toBe("xt:t:s:t4521");
    expect(titleKey("t", "series", { id: "3101" })).toBe("xt:t:s:3101");
  });

  it("carries the playlist, so two playlists never share a title", () => {
    expect(titleKey(UUID, "movie", { id: "1", tmdb: 5 })).toBe(`xt:${UUID}:m:t5`);
    expect(titleKey("a", "movie", { id: "1", tmdb: 5 })).not.toBe(titleKey("b", "movie", { id: "1", tmdb: 5 }));
  });

  it("is the same for every copy of a title with one TMDB id", () => {
    expect(titleKey("t", "movie", { id: "1", tmdb: 9 })).toBe(titleKey("t", "movie", { id: "2", tmdb: 9 }));
  });

  it("keeps a movie and a show with one number apart", () => {
    expect(titleKey("t", "movie", { id: "7" })).not.toBe(titleKey("t", "series", { id: "7" }));
  });
});

describe("an episode's key", () => {
  it("is its show's key and then the season and the episode", () => {
    expect(episodeKey("xt:t:s:t4521", 1, 3)).toBe("xt:t:s:t4521:1:3");
    expect(episodeKey("xt:t:s:3101", 0, 12)).toBe("xt:t:s:3101:0:12");
  });
});

describe("reading a key back", () => {
  it("reads every shape the plan lists", () => {
    expect(readKey("xt:t:m:t617126")).toEqual({ playlistId: "t", kind: "movie", tmdb: 617126 });
    expect(readKey("xt:t:m:52114")).toEqual({ playlistId: "t", kind: "movie", panelId: "52114" });
    expect(readKey("xt:t:s:t4521")).toEqual({ playlistId: "t", kind: "series", tmdb: 4521 });
    expect(readKey("xt:t:s:3101")).toEqual({ playlistId: "t", kind: "series", panelId: "3101" });
    expect(readKey("xt:t:s:t4521:1:3")).toEqual({ playlistId: "t", kind: "series", tmdb: 4521, season: 1, episode: 3 });
    expect(readKey("xt:t:s:3101:0:12")).toEqual({ playlistId: "t", kind: "series", panelId: "3101", season: 0, episode: 12 });
    expect(readKey(`xt:${UUID}:m:t5`)).toEqual({ playlistId: UUID, kind: "movie", tmdb: 5 });
  });

  it("round-trips what it makes", () => {
    for (const [pl, kind, copy] of [
      ["t", "movie", { id: "1", tmdb: 8 }],
      [UUID, "movie", { id: "420" }],
      [UUID, "series", { id: "9", tmdb: 70001 }],
      ["x", "series", { id: "9" }],
    ] as const) {
      const key = titleKey(pl, kind, copy);
      const k = readKey(key);
      expect(k, key).toMatchObject({ playlistId: pl, kind });
      expect(k?.tmdb ?? k?.panelId).toEqual("tmdb" in copy ? copy.tmdb : copy.id);
      const ep = episodeKey(key, 2, 5);
      if (kind === "series") expect(readKey(ep), ep).toMatchObject({ playlistId: pl, kind, season: 2, episode: 5 });
    }
  });

  it("is null for every key that is not one of these", () => {
    for (const key of [
      "jf:0123456789abcdef0123456789abcdef", // Jellyfin's
      "tt0111161", // an IMDb id
      "tt11280740:1:1", // an episode of one
      "kitsu:1234",
      "xt:t:m:t0", // a TMDB id is positive
      "xt:t:m:0", // a panel id is positive
      "xt:t:m:007", // and has no leading zero
      "xt:t:m:t007",
      "xt:t:m:-5",
      "xt:t:m:t",
      "xt:t:m:",
      "xt:t:x:5", // not a movie or a show
      "xt::m:5", // no playlist
      "xt:t:m:5:1:2", // an episode of a movie
      "xt:t:s:5:1", // half an episode
      "xt:t:s:5:1:2:3",
      "xt:t:s:5:a:2",
      "xt:t:s:5:-1:2",
      "xt:a:b:s:5", // a colon in the playlist id
      "XT:t:m:5",
      " xt:t:m:5",
      "xt:t:m:5 ",
      "",
    ])
      expect(readKey(key), JSON.stringify(key)).toBeNull();
  });
});

describe("the title a key belongs to", () => {
  it("is a show's for its episode, and its own for a title", () => {
    expect(titleOf("xt:t:s:t4521:1:3")).toBe("xt:t:s:t4521");
    expect(titleOf("xt:t:s:3101:0:12")).toBe("xt:t:s:3101");
    expect(titleOf("xt:t:s:t4521")).toBe("xt:t:s:t4521");
    expect(titleOf("xt:t:m:t5")).toBe("xt:t:m:t5");
    expect(titleOf(`xt:${UUID}:s:t4521:2:1`)).toBe(`xt:${UUID}:s:t4521`);
  });

  it("is null for a key that is not one of these", () => {
    expect(titleOf("tt11280740:1:1")).toBeNull();
    expect(titleOf("jf:abc")).toBeNull();
    expect(titleOf("xt:t:m:t5:1:2")).toBeNull();
  });
});
