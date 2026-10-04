import { describe, expect, it } from "vitest";
import { blammyId, packEpisode, packMovie, packSeries, unpack, type MediaType, type Packed } from "./ids";

// The vectors are what AIOStreams v2.35.9's own `tryPack` returns
// (core/src/jellyfin/ids.ts:150-185); the first and the Kitsu ones were also
// worked out by hand: 111161 is 0x01b239, 903747 is 0x0dca43, 7442 is 0x1d12.
const MOVIE = "a1110100000001b239ffffffff000000"; // tt0111161, movie
const SERIES = "a121020000000dca43ffffffff000000"; // tt0903747, series
const EPISODE = "a141020000000dca4300030007000000"; // tt0903747:3:7, series
const KITSU_SERIES = "a12403000000001d12ffffffff000000"; // kitsu:7442, anime
const KITSU_EPISODE = "a14403000000001d1200010005000000"; // kitsu:7442:5, season 1, anime

/** The 8-4-4-4-12 GUID form a Jellyfin client may send. */
const guid = (hex: string) => [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");

describe("packing, against AIOStreams' own vectors", () => {
  it("a film", () => {
    expect(packMovie("tt0111161")).toBe(MOVIE);
  });

  it("a show", () => {
    expect(packSeries("tt0903747")).toBe(SERIES);
  });

  it("an episode, its season and number from the id", () => {
    expect(packEpisode("tt0903747:3:7")).toBe(EPISODE);
  });

  it("a Kitsu show, under the anime type", () => {
    expect(packSeries("kitsu:7442", "anime")).toBe(KITSU_SERIES);
  });

  it("a Kitsu episode, which has no season of its own, takes season 1", () => {
    expect(packEpisode("kitsu:7442:5", { type: "anime" })).toBe(KITSU_EPISODE);
  });

  it("a Kitsu episode takes the season it is given", () => {
    expect(packEpisode("kitsu:7442:5", { type: "anime", season: 2 })).toBe("a14403000000001d1200020005000000");
  });

  it("an IMDb episode ignores a season it is given: its id already says", () => {
    expect(packEpisode("tt0903747:3:7", { season: 9 })).toBe(EPISODE);
  });

  it("the type is part of the id: a film and a series film differ", () => {
    expect(packMovie("tt0111161", "series")).toBe("a1110200000001b239ffffffff000000");
    expect(packMovie("tt0111161", "anime")).toBe("a1110300000001b239ffffffff000000");
    expect(packMovie("tt0111161", "tv")).toBe("a1110400000001b239ffffffff000000");
    expect(packMovie("tt0111161", "other")).toBe("a1110500000001b239ffffffff000000");
    expect(packMovie("tt0111161", "channel")).toBe("a1110600000001b239ffffffff000000");
  });

  it("an IMDb id of eight digits keeps all of them", () => {
    const hex = packMovie("tt12345678");
    expect(hex).toBe("a11101000000bc614effffffff000000");
    expect(unpack(hex)?.id).toBe("tt12345678");
  });

  it("the whole 48 bits of the number survive, both halves", () => {
    // 2^48 - 1: every byte of the field set.
    expect(packMovie("tt281474976710655")).toBe("a11101ffffffffffffffffffff000000");
    expect(unpack("a11101ffffffffffffffffffff000000")?.id).toBe("tt281474976710655");
    // 2^32: only the low bit of the high half.
    expect(packSeries("kitsu:4294967296", "anime")).toBe("a12403000100000000ffffffff000000");
    expect(unpack("a12403000100000000ffffffff000000")?.id).toBe("kitsu:4294967296");
  });

  it("the last season and episode that fit, 65534", () => {
    const hex = packEpisode("tt0903747:65534:65534");
    expect(hex).toBe("a141020000000dca43fffefffe000000");
    expect(unpack(hex)).toMatchObject({ season: 65534, episode: 65534 });
  });
});

describe("what does not pack", () => {
  it("an IMDb id that AIOStreams would rebuild differently", () => {
    // It rebuilds the number zero-padded to seven digits, so these are not
    // the id it would hand out for the same number.
    expect(packMovie("tt123")).toBeNull();
    expect(packMovie("tt0")).toBeNull();
    expect(packMovie("tt00000001")).toBeNull();
    expect(packMovie("tt0111161 ")).toBeNull();
  });

  it("an IMDb number past 48 bits", () => {
    expect(packMovie("tt281474976710656")).toBeNull();
    expect(packMovie("tt1000000000000000000000")).toBeNull();
  });

  it("a Kitsu id that is not written as AIOStreams rebuilds it", () => {
    expect(packSeries("kitsu:07442", "anime")).toBeNull();
    expect(packSeries("kitsu7442", "anime")).toBeNull();
    expect(packSeries("kitsu-7442", "anime")).toBeNull();
    expect(packSeries("kitsu:", "anime")).toBeNull();
  });

  it("an id type BlammyTV does not have", () => {
    for (const id of ["tmdb:603", "tvdb:81189", "mal:16498", "anilist:1", "anidb:23", "simkl:9", "imdb:0111161", "tt:0111161"]) {
      expect(packMovie(id), id).toBeNull();
      expect(packSeries(id), id).toBeNull();
    }
  });

  it("nothing, or something that is not an id", () => {
    for (const id of ["", "tt", "kitsu:", "0111161", "Tt0111161", "tt01111a1"]) {
      expect(packMovie(id), id).toBeNull();
    }
  });

  it("an episode id given where a title id goes, and the other way round", () => {
    expect(packMovie("tt0903747:3:7")).toBeNull();
    expect(packSeries("kitsu:7442:5", "anime")).toBeNull();
    expect(packEpisode("tt0903747")).toBeNull();
    expect(packEpisode("kitsu:7442", { type: "anime" })).toBeNull();
  });

  it("an episode id AIOStreams would not generate from the numbers", () => {
    expect(packEpisode("tt0903747:03:7")).toBeNull();
    expect(packEpisode("tt0903747:3:07")).toBeNull();
    expect(packEpisode("kitsu:7442:05", { type: "anime" })).toBeNull();
    expect(packEpisode("tt123:1:2")).toBeNull();
    expect(packEpisode("tt0903747:3:7:1")).toBeNull();
    expect(packEpisode("tt0903747:3")).toBeNull();
    expect(packEpisode("tmdb:1:2:3")).toBeNull();
    expect(packEpisode("")).toBeNull();
  });

  it("a season or episode of 65535 or more, which is the 'none' value", () => {
    expect(packEpisode("tt0903747:65535:1")).toBeNull();
    expect(packEpisode("tt0903747:1:65535")).toBeNull();
    expect(packEpisode("tt0903747:99999:1")).toBeNull();
    expect(packEpisode("kitsu:7442:65535", { type: "anime" })).toBeNull();
  });

  it("a Kitsu season that is not a season", () => {
    expect(packEpisode("kitsu:7442:5", { type: "anime", season: 65535 })).toBeNull();
    expect(packEpisode("kitsu:7442:5", { type: "anime", season: -1 })).toBeNull();
    expect(packEpisode("kitsu:7442:5", { type: "anime", season: 1.5 })).toBeNull();
    expect(packEpisode("kitsu:7442:5", { type: "anime", season: NaN })).toBeNull();
  });

  it("a media type that is not one", () => {
    expect(packMovie("tt0111161", "bogus" as MediaType)).toBeNull();
    expect(packSeries("tt0903747", "" as MediaType)).toBeNull();
    expect(packEpisode("tt0903747:3:7", { type: "bogus" as MediaType })).toBeNull();
  });
});

describe("unpacking", () => {
  it("reads each vector back", () => {
    expect(unpack(MOVIE)).toEqual({ kind: "movie", type: "movie", id: "tt0111161" });
    expect(unpack(SERIES)).toEqual({ kind: "series", type: "series", id: "tt0903747" });
    expect(unpack(EPISODE)).toEqual({ kind: "episode", type: "series", id: "tt0903747", season: 3, episode: 7 });
    expect(unpack(KITSU_SERIES)).toEqual({ kind: "series", type: "anime", id: "kitsu:7442" });
    expect(unpack(KITSU_EPISODE)).toEqual({ kind: "episode", type: "anime", id: "kitsu:7442", season: 1, episode: 5 });
  });

  it("a season: its number, no episode", () => {
    expect(unpack("a131020000000dca430002ffff000000")).toEqual({ kind: "season", type: "series", id: "tt0903747", season: 2 });
  });

  it("a collection", () => {
    expect(unpack("a151010000000dca43ffffffff000000")).toEqual({ kind: "boxset", type: "movie", id: "tt0903747" });
  });

  it("an episode with no season or number reads as one, without them", () => {
    expect(unpack("a141020000000dca43ffffffff000000")).toEqual({ kind: "episode", type: "series", id: "tt0903747" });
  });

  it("reads uppercase and the hyphenated GUID form, as AIOStreams does", () => {
    const want = unpack(EPISODE);
    expect(want).not.toBeNull();
    expect(unpack(EPISODE.toUpperCase())).toEqual(want);
    expect(unpack(guid(EPISODE))).toEqual(want);
    expect(unpack(guid(EPISODE).toUpperCase())).toEqual(want);
    expect(guid(MOVIE)).toBe("a1110100-0000-01b2-39ff-ffffff000000");
    expect(unpack(guid(MOVIE))).toEqual({ kind: "movie", type: "movie", id: "tt0111161" });
  });

  it("is null for the wrong length", () => {
    expect(unpack("a1")).toBeNull();
    expect(unpack("")).toBeNull();
    expect(unpack(MOVIE.slice(0, 30))).toBeNull();
    expect(unpack(MOVIE.slice(0, 31))).toBeNull();
    expect(unpack(MOVIE + "00")).toBeNull();
    expect(unpack(MOVIE + "0")).toBeNull();
  });

  it("is null for what is not hex", () => {
    expect(unpack("z" + MOVIE.slice(1))).toBeNull();
    expect(unpack(MOVIE.slice(0, 31) + "g")).toBeNull();
    expect(unpack("not an item id at all, not at all!")).toBeNull();
    expect(unpack(" " + MOVIE.slice(1))).toBeNull();
  });

  it("is null when there is nothing to read", () => {
    expect(unpack(undefined)).toBeNull();
    expect(unpack(null)).toBeNull();
  });

  it("is null for another mark: views, genres, people, sources, hashed ids", () => {
    for (const mark of ["a2", "a3", "a5", "a6", "a7", "b2", "00", "ff"]) {
      expect(unpack(mark + MOVIE.slice(2)), mark).toBeNull();
    }
  });

  it("is null for an id type BlammyTV does not have", () => {
    // 2 TMDB, 3 TVDB, 5 MAL, 6 AniList, 7 AniDB, 8 Simkl, and two unassigned.
    for (const code of [2, 3, 5, 6, 7, 8, 0, 9, 15]) {
      expect(unpack(`a11${code.toString(16)}0100000001b239ffffffff000000`), String(code)).toBeNull();
    }
  });

  it("is null for a kind or a media type that does not exist", () => {
    // Kind 0, 6 and 15; media type 0, 7 and 255.
    for (const kind of ["0", "6", "f"]) expect(unpack(`a1${kind}10100000001b239ffffffff000000`), kind).toBeNull();
    for (const media of ["00", "07", "ff"]) expect(unpack(`a111${media}00000001b239ffffffff000000`), media).toBeNull();
  });
});

describe("round trips", () => {
  const types: MediaType[] = ["movie", "series", "anime", "tv", "other", "channel"];

  it("every title packs and unpacks to the id and type it came from", () => {
    for (const id of ["tt0111161", "tt0903747", "tt12345678", "tt0000001", "kitsu:1", "kitsu:7442", "kitsu:4294967297"]) {
      for (const type of types) {
        expect(unpack(packMovie(id, type)), `${id} ${type}`).toEqual({ kind: "movie", type, id });
        expect(unpack(packSeries(id, type)), `${id} ${type}`).toEqual({ kind: "series", type, id });
      }
    }
  });

  it("every episode comes back as the id it went in as", () => {
    for (const id of ["tt0903747:1:1", "tt0903747:0:12", "tt0903747:65534:65534", "tt12345678:2:300", "kitsu:7442:1", "kitsu:7442:1100"]) {
      const p = unpack(packEpisode(id, { type: "anime" }));
      expect(p, id).not.toBeNull();
      expect(blammyId(p as Packed), id).toBe(id);
    }
  });

  it("is 32 lowercase hex, whatever went in", () => {
    for (const hex of [packMovie("tt0111161"), packSeries("kitsu:7442", "anime"), packEpisode("tt0903747:65534:65534")]) {
      expect(hex).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe("blammyId", () => {
  it("a film or a show: its base id", () => {
    expect(blammyId({ kind: "movie", type: "movie", id: "tt0111161" })).toBe("tt0111161");
    expect(blammyId({ kind: "series", type: "series", id: "tt0903747" })).toBe("tt0903747");
    expect(blammyId({ kind: "series", type: "anime", id: "kitsu:7442" })).toBe("kitsu:7442");
  });

  it("an IMDb episode: tt…:S:E", () => {
    expect(blammyId({ kind: "episode", type: "series", id: "tt0903747", season: 3, episode: 7 })).toBe("tt0903747:3:7");
  });

  it("a Kitsu episode: kitsu:N:E, the season dropped", () => {
    expect(blammyId({ kind: "episode", type: "anime", id: "kitsu:7442", season: 2, episode: 5 })).toBe("kitsu:7442:5");
  });

  it("an episode with no number, or an IMDb one with no season", () => {
    expect(blammyId({ kind: "episode", type: "series", id: "tt0903747" })).toBeNull();
    expect(blammyId({ kind: "episode", type: "series", id: "tt0903747", season: 3 })).toBeNull();
    expect(blammyId({ kind: "episode", type: "series", id: "tt0903747", episode: 7 })).toBeNull();
  });

  it("a season or a collection: null", () => {
    expect(blammyId({ kind: "season", type: "series", id: "tt0903747", season: 2 })).toBeNull();
    expect(blammyId({ kind: "boxset", type: "movie", id: "tt0111161" })).toBeNull();
  });
});
