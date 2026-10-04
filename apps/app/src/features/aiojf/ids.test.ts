import { describe, expect, it } from "vitest";
import { blammyId, jellyfinIdOf, packEpisode, packMovie, packSeries, unpack, type MediaType, type Packed } from "./ids";
import { packedFor } from "./report";

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

  it("an id type AIOStreams does not pack", () => {
    for (const id of ["animeplanet:1", "trakt:9", "imdb:0111161", "tt:0111161"]) {
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
    expect(packEpisode("trakt:1:2:3")).toBeNull();
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

  it("is null for an id type AIOStreams does not assign", () => {
    for (const code of [0, 9, 15]) {
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

// Plan 024, B2: the other six id types AIOStreams packs. The vectors are what
// AIOStreams v2.35.9's own code returns: `tryPack` and `unpack` from
// core/src/jellyfin/ids.ts:23-216 (the tables, `rebuildBaseId`, `numericOf`,
// `isRebuildableVideoId`, `tryPack`, `unpack`, cut out of the clone with no
// edit) and core/src/utils/id-parser.ts copied beside them, run under node 22.
// The same run gave the IMDb and Kitsu vectors at the top of this file
// unchanged, which is the check that the cut-out is the real thing. The
// numbers are the ones in the ids: 603 is 0x025b, 1396 is 0x0574, 290434 is
// 0x046e82, 81189 is 0x013d25, 5114 is 0x13fa, 16498 is 0x4072, 9541 is
// 0x2545, 12345 is 0x3039.
const TMDB_MOVIE = "a1120100000000025bffffffff000000"; // tmdb:603, movie
const TMDB_SERIES = "a12202000000000574ffffffff000000"; // tmdb:1396, series
const TMDB_EPISODE = "a1420200000000057400030007000000"; // tmdb:1396:3:7, series
const TVDB_MOVIE = "a11301000000046e82ffffffff000000"; // tvdb:290434, movie
const TVDB_SERIES = "a12302000000013d25ffffffff000000"; // tvdb:81189, series
const TVDB_EPISODE = "a14302000000013d2500020005000000"; // tvdb:81189:2:5, series
const MAL_MOVIE = "a115010000000013faffffffff000000"; // mal:5114, movie
const MAL_SERIES = "a12503000000004072ffffffff000000"; // mal:16498, anime
const MAL_EPISODE = "a1450300000000407200010004000000"; // mal:16498:4, season 1, anime
const ANILIST_SERIES = "a12603000000004072ffffffff000000"; // anilist:16498, anime
const ANILIST_EPISODE = "a1460300000000407200010002000000"; // anilist:16498:2, season 1, anime
const ANIDB_SERIES = "a12703000000002545ffffffff000000"; // anidb:9541, anime
const ANIDB_EPISODE = "a1470300000000254500010003000000"; // anidb:9541:3, season 1, anime
const SIMKL_MOVIE = "a11801000000003039ffffffff000000"; // simkl:12345, movie
const SIMKL_SERIES = "a12802000000003039ffffffff000000"; // simkl:12345, series
const SIMKL_EPISODE = "a1480200000000303900010002000000"; // simkl:12345:2, season 1, series

describe("every id type AIOStreams packs, against its own vectors", () => {
  it("TMDB: a film, a show and an episode with its season", () => {
    expect(packMovie("tmdb:603")).toBe(TMDB_MOVIE);
    expect(packSeries("tmdb:1396")).toBe(TMDB_SERIES);
    expect(packEpisode("tmdb:1396:3:7")).toBe(TMDB_EPISODE);
  });

  it("TVDB: a film, a show and an episode with its season", () => {
    expect(packMovie("tvdb:290434")).toBe(TVDB_MOVIE);
    expect(packSeries("tvdb:81189")).toBe(TVDB_SERIES);
    expect(packEpisode("tvdb:81189:2:5")).toBe(TVDB_EPISODE);
  });

  it("TMDB and TVDB episodes carry their own season, so opts.season is ignored", () => {
    expect(packEpisode("tmdb:1396:3:7", { season: 9 })).toBe(TMDB_EPISODE);
    expect(packEpisode("tvdb:81189:2:5", { season: 9 })).toBe(TVDB_EPISODE);
  });

  it("MAL: a film, an anime show and an episode, which takes season 1 unless told", () => {
    expect(packMovie("mal:5114")).toBe(MAL_MOVIE);
    expect(packSeries("mal:16498", "anime")).toBe(MAL_SERIES);
    expect(packEpisode("mal:16498:4", { type: "anime" })).toBe(MAL_EPISODE);
    expect(packEpisode("mal:16498:4", { type: "anime", season: 2 })).toBe("a1450300000000407200020004000000");
  });

  it("AniList and AniDB: an anime show and an episode, season 1 unless told", () => {
    expect(packSeries("anilist:16498", "anime")).toBe(ANILIST_SERIES);
    expect(packEpisode("anilist:16498:2", { type: "anime" })).toBe(ANILIST_EPISODE);
    expect(packSeries("anidb:9541", "anime")).toBe(ANIDB_SERIES);
    expect(packEpisode("anidb:9541:3", { type: "anime" })).toBe(ANIDB_EPISODE);
  });

  it("Simkl: a film, a show and an episode, season 1 unless told", () => {
    expect(packMovie("simkl:12345")).toBe(SIMKL_MOVIE);
    expect(packSeries("simkl:12345")).toBe(SIMKL_SERIES);
    expect(packEpisode("simkl:12345:2")).toBe(SIMKL_EPISODE);
  });

  it("the id type code is in the second byte, under the kind", () => {
    // kind << 4 | code: 1 to 8 in the low nibble, in AIOStreams' table order.
    const lows = [
      packMovie("tt0111161"),
      packMovie("tmdb:603"),
      packMovie("tvdb:290434"),
      packMovie("kitsu:1555"),
      packMovie("mal:5114"),
      packMovie("anilist:1"),
      packMovie("anidb:1"),
      packMovie("simkl:12345"),
    ].map((hex) => hex?.slice(3, 4));
    expect(lows).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("the top of the number range survives for a new type too", () => {
    // 2^48 - 1 for MAL, and 2^32 for TVDB (only the low bit of the high half).
    expect(packSeries("mal:281474976710655", "anime")).toBe("a12503ffffffffffffffffffff000000");
    expect(unpack("a12503ffffffffffffffffffff000000")?.id).toBe("mal:281474976710655");
    expect(packSeries("tvdb:4294967296")).toBe("a12302000100000000ffffffff000000");
    expect(unpack("a12302000100000000ffffffff000000")?.id).toBe("tvdb:4294967296");
  });
});

describe("what the new id types do not pack (AIOStreams returns null for each)", () => {
  it("a base id that is not written the way AIOStreams rebuilds it", () => {
    for (const id of ["tmdb:0603", "tmdb-603", "tmdb603", "tmdb:", "TMDB:603", "tvdb:081189", "mal:05114", "anilist:016498", "anidb:09541", "simkl:012345"]) {
      expect(packMovie(id), id).toBeNull();
      expect(packSeries(id), id).toBeNull();
    }
  });

  it("a number past 48 bits", () => {
    expect(packSeries("mal:281474976710656", "anime")).toBeNull();
    expect(packMovie("tmdb:99999999999999999999")).toBeNull();
  });

  it("an id type AIOStreams has no code for", () => {
    // Its parser reads these (ID_TYPES), but ID_TYPE_CODES has no row for them.
    for (const id of ["animeplanet:123", "acd:1", "anisearch:1", "notifymoe:abc", "trakt:123", "livechart:1"]) {
      expect(packMovie(id), id).toBeNull();
      expect(packSeries(id, "anime"), id).toBeNull();
    }
  });

  it("an episode id AIOStreams would not generate from the numbers", () => {
    // TMDB and TVDB want S and E; the season-less types want only E.
    expect(packEpisode("tmdb:1396:03:7")).toBeNull();
    expect(packEpisode("tmdb:1396:7")).toBeNull();
    expect(packEpisode("tvdb:81189:2:05")).toBeNull();
    expect(packEpisode("tvdb:81189:2")).toBeNull();
    expect(packEpisode("mal:16498:1:4", { type: "anime" })).toBeNull();
    expect(packEpisode("mal:16498:04", { type: "anime" })).toBeNull();
    expect(packEpisode("anilist:16498:1:2", { type: "anime" })).toBeNull();
    expect(packEpisode("anidb:9541:1:3", { type: "anime" })).toBeNull();
    expect(packEpisode("simkl:12345:1:2")).toBeNull();
    expect(packEpisode("mal:16498", { type: "anime" })).toBeNull();
  });

  it("a season or episode of 65535 or more, or a season that is not one", () => {
    expect(packEpisode("tmdb:1396:65535:1")).toBeNull();
    expect(packEpisode("tvdb:81189:1:99999")).toBeNull();
    expect(packEpisode("mal:16498:65535", { type: "anime" })).toBeNull();
    expect(packEpisode("mal:16498:4", { type: "anime", season: 65535 })).toBeNull();
    expect(packEpisode("simkl:12345:2", { season: -1 })).toBeNull();
  });

  it("an episode of a film id, and the other way round", () => {
    expect(packMovie("tmdb:1396:3:7")).toBeNull();
    expect(packSeries("mal:16498:4", "anime")).toBeNull();
    expect(packEpisode("tmdb:1396")).toBeNull();
  });
});

describe("unpacking the new id types", () => {
  it("reads each vector back as the id and type it came from", () => {
    expect(unpack(TMDB_MOVIE)).toEqual({ kind: "movie", type: "movie", id: "tmdb:603" });
    expect(unpack(TMDB_SERIES)).toEqual({ kind: "series", type: "series", id: "tmdb:1396" });
    expect(unpack(TMDB_EPISODE)).toEqual({ kind: "episode", type: "series", id: "tmdb:1396", season: 3, episode: 7 });
    expect(unpack(TVDB_MOVIE)).toEqual({ kind: "movie", type: "movie", id: "tvdb:290434" });
    expect(unpack(TVDB_EPISODE)).toEqual({ kind: "episode", type: "series", id: "tvdb:81189", season: 2, episode: 5 });
    expect(unpack(MAL_MOVIE)).toEqual({ kind: "movie", type: "movie", id: "mal:5114" });
    expect(unpack(MAL_SERIES)).toEqual({ kind: "series", type: "anime", id: "mal:16498" });
    expect(unpack(MAL_EPISODE)).toEqual({ kind: "episode", type: "anime", id: "mal:16498", season: 1, episode: 4 });
    expect(unpack(ANILIST_SERIES)).toEqual({ kind: "series", type: "anime", id: "anilist:16498" });
    expect(unpack(ANILIST_EPISODE)).toEqual({ kind: "episode", type: "anime", id: "anilist:16498", season: 1, episode: 2 });
    expect(unpack(ANIDB_SERIES)).toEqual({ kind: "series", type: "anime", id: "anidb:9541" });
    expect(unpack(ANIDB_EPISODE)).toEqual({ kind: "episode", type: "anime", id: "anidb:9541", season: 1, episode: 3 });
    expect(unpack(SIMKL_MOVIE)).toEqual({ kind: "movie", type: "movie", id: "simkl:12345" });
    expect(unpack(SIMKL_SERIES)).toEqual({ kind: "series", type: "series", id: "simkl:12345" });
    expect(unpack(SIMKL_EPISODE)).toEqual({ kind: "episode", type: "series", id: "simkl:12345", season: 1, episode: 2 });
  });

  it("is still null for an id type code AIOStreams has no row for", () => {
    for (const code of [0, 9, 15]) {
      expect(unpack(`a11${code.toString(16)}0100000001b239ffffffff000000`), String(code)).toBeNull();
    }
  });
});

describe("blammyId for the new id types", () => {
  it("TMDB and TVDB episodes keep their season, as IMDb's do", () => {
    expect(blammyId(must(unpack(TMDB_EPISODE)))).toBe("tmdb:1396:3:7");
    expect(blammyId(must(unpack(TVDB_EPISODE)))).toBe("tvdb:81189:2:5");
  });

  it("MAL, AniList, AniDB and Simkl episodes drop it, as Kitsu's do", () => {
    expect(blammyId(must(unpack(MAL_EPISODE)))).toBe("mal:16498:4");
    expect(blammyId(must(unpack(ANILIST_EPISODE)))).toBe("anilist:16498:2");
    expect(blammyId(must(unpack(ANIDB_EPISODE)))).toBe("anidb:9541:3");
    expect(blammyId(must(unpack(SIMKL_EPISODE)))).toBe("simkl:12345:2");
  });

  it("a film or a show is its base id", () => {
    expect(blammyId(must(unpack(TMDB_MOVIE)))).toBe("tmdb:603");
    expect(blammyId(must(unpack(MAL_SERIES)))).toBe("mal:16498");
  });

  it("an episode of a season-carrying type with no season, or of no known type: null", () => {
    expect(blammyId({ kind: "episode", type: "series", id: "tmdb:1396", episode: 7 })).toBeNull();
    expect(blammyId({ kind: "episode", type: "series", id: "tvdb:81189", episode: 5 })).toBeNull();
    expect(blammyId({ kind: "episode", type: "series", id: "yt:abc", season: 1, episode: 5 })).toBeNull();
  });
});

describe("round trips across every id type", () => {
  const titles = ["tt0111161", "tmdb:603", "tvdb:81189", "kitsu:7442", "mal:16498", "anilist:16498", "anidb:9541", "simkl:12345"];
  const episodes = ["tt0903747:3:7", "tmdb:1396:3:7", "tvdb:81189:2:5", "kitsu:7442:5", "mal:16498:4", "anilist:16498:2", "anidb:9541:3", "simkl:12345:2"];

  it("every title packs and unpacks to the id and type it came from", () => {
    for (const id of titles) {
      expect(unpack(packMovie(id, "movie")), id).toEqual({ kind: "movie", type: "movie", id });
      expect(unpack(packSeries(id, "anime")), id).toEqual({ kind: "series", type: "anime", id });
    }
  });

  it("every episode comes back as the id it went in as", () => {
    for (const id of episodes) {
      const p = unpack(packEpisode(id, { type: "anime" }));
      expect(p, id).not.toBeNull();
      expect(blammyId(p as Packed), id).toBe(id);
    }
  });
});

describe("jellyfinIdOf", () => {
  it("a film is packed as a movie, whatever its id type", () => {
    expect(jellyfinIdOf("tt0111161", "movie")).toBe(MOVIE);
    expect(jellyfinIdOf("tmdb:603", "movie")).toBe(TMDB_MOVIE);
    expect(jellyfinIdOf("mal:5114", "movie")).toBe(MAL_MOVIE);
    expect(jellyfinIdOf("simkl:12345", "movie")).toBe(SIMKL_MOVIE);
  });

  it("a show is packed as a series", () => {
    expect(jellyfinIdOf("tt0903747", "series")).toBe(SERIES);
    expect(jellyfinIdOf("tmdb:1396", "series")).toBe(TMDB_SERIES);
    expect(jellyfinIdOf("tvdb:81189", "series")).toBe(TVDB_SERIES);
    expect(jellyfinIdOf("simkl:12345", "series")).toBe(SIMKL_SERIES);
  });

  it("a show under an anime-only id type is typed anime, as report.ts does for Kitsu", () => {
    expect(jellyfinIdOf("kitsu:7442", "series")).toBe(KITSU_SERIES);
    expect(jellyfinIdOf("mal:16498", "series")).toBe(MAL_SERIES);
    expect(jellyfinIdOf("anilist:16498", "series")).toBe(ANILIST_SERIES);
    expect(jellyfinIdOf("anidb:9541", "series")).toBe(ANIDB_SERIES);
  });

  it("a show the caller already knows as anime stays anime, even under an IMDb id", () => {
    expect(jellyfinIdOf("kitsu:7442", "anime")).toBe(KITSU_SERIES);
    expect(jellyfinIdOf("tt0903747", "anime")).toBe(packSeries("tt0903747", "anime"));
  });

  it("an episode is packed as an episode of its show", () => {
    expect(jellyfinIdOf("tt0903747:3:7", "series")).toBe(EPISODE);
    expect(jellyfinIdOf("tmdb:1396:3:7", "series")).toBe(TMDB_EPISODE);
    expect(jellyfinIdOf("tvdb:81189:2:5", "series")).toBe(TVDB_EPISODE);
    expect(jellyfinIdOf("simkl:12345:2", "series")).toBe(SIMKL_EPISODE);
  });

  it("an episode under an anime-only id type is typed anime and takes the season it is given", () => {
    expect(jellyfinIdOf("kitsu:7442:5", "series")).toBe(KITSU_EPISODE);
    expect(jellyfinIdOf("kitsu:7442:5", "series", { season: 2 })).toBe("a14403000000001d1200020005000000");
    expect(jellyfinIdOf("mal:16498:4", "series")).toBe(MAL_EPISODE);
    expect(jellyfinIdOf("anilist:16498:2", "anime")).toBe(ANILIST_EPISODE);
    expect(jellyfinIdOf("anidb:9541:3", "series")).toBe(ANIDB_EPISODE);
  });

  it("an IMDb or TMDB episode ignores the season it is given", () => {
    expect(jellyfinIdOf("tt0903747:3:7", "series", { season: 9 })).toBe(EPISODE);
    expect(jellyfinIdOf("tmdb:1396:3:7", "series", { season: 9 })).toBe(TMDB_EPISODE);
  });

  it("decides as report.ts packedFor does, for what that handles", () => {
    expect(jellyfinIdOf("tt0111161", "movie")).toBe(packedFor({ itemId: "tt0111161", kind: "movie" }));
    expect(jellyfinIdOf("tt0903747:3:7", "series")).toBe(
      packedFor({ itemId: "tt0903747", kind: "series", episodeId: "tt0903747:3:7", season: 3 }),
    );
    expect(jellyfinIdOf("kitsu:1555:4", "series", { season: 2 })).toBe(
      packedFor({ itemId: "kitsu:1555", kind: "series", episodeId: "kitsu:1555:4", season: 2 }),
    );
    expect(jellyfinIdOf("kitsu:1555:4", "series")).toBe(packedFor({ itemId: "kitsu:1555", kind: "series", episodeId: "kitsu:1555:4" }));
  });

  it("is null for an id AIOStreams would hash instead of pack", () => {
    for (const id of ["tt123", "tt0111161 ", "tmdb:0603", "mal:05114", "yt:dQw4w9WgXcQ", "animeplanet:1", "https://example.com/x", "", "kitsu:"]) {
      expect(jellyfinIdOf(id, "movie"), id).toBeNull();
      expect(jellyfinIdOf(id, "series"), id).toBeNull();
    }
    expect(jellyfinIdOf("tt0903747:03:7", "series")).toBeNull();
    expect(jellyfinIdOf("tmdb:1396:7", "series")).toBeNull();
    expect(jellyfinIdOf("mal:16498:1:4", "series")).toBeNull();
    expect(jellyfinIdOf("kitsu:7442:5", "series", { season: 65535 })).toBeNull();
  });

  it("is null for a type it cannot tell a film from a show under, or that AIOStreams has no code for", () => {
    for (const type of ["tv", "channel", "other", "anime.series", "anime.movie", "events", ""]) {
      expect(jellyfinIdOf("tt0111161", type), type).toBeNull();
      expect(jellyfinIdOf("tt0903747:3:7", type), type).toBeNull();
    }
  });

  it("is null for an episode id under the film type", () => {
    expect(jellyfinIdOf("tt0903747:3:7", "movie")).toBeNull();
    expect(jellyfinIdOf("kitsu:7442:5", "movie")).toBeNull();
  });
});

function must<V>(v: V | null | undefined): V {
  if (v == null) throw new Error("a fixture did not decode");
  return v;
}
