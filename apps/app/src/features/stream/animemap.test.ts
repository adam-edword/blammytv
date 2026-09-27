import { describe, expect, it } from "vitest";
import {
  absoluteEpisode,
  buildIndex,
  buildKitsuIndex,
  looksAnime,
  malEpisodeOf,
  malFilmOf,
  malWatchedEpisodes,
  resolveMal,
  type AnimeIndexes,
} from "./animemap";
import type { Season } from "./model";

/** Attack on Titan's real dataset rows (verified against Fribb/anime-lists
 * 2026-07-10): per-season MAL entries, S3/S4 split across cours via
 * episode_offset. */
const AOT = buildIndex([
  { imdb_id: "tt2560140", mal_id: 16498, type: "TV", season: { tvdb: 1 } },
  { imdb_id: "tt2560140", type: "OVA", season: { tvdb: 0 } }, // no mal_id → dropped
  { imdb_id: "tt2560140", mal_id: 25777, type: "TV", season: { tvdb: 2 } },
  { imdb_id: "tt2560140", mal_id: 35760, type: "TV", season: { tvdb: 3 } },
  {
    imdb_id: "tt2560140",
    mal_id: 38524,
    type: "TV",
    season: { tvdb: 3 },
    episode_offset: { tvdb: 12 },
  },
  { imdb_id: "tt2560140", mal_id: 40028, type: "TV", season: { tvdb: 4 } },
  {
    imdb_id: "tt2560140",
    mal_id: 48583,
    type: "TV",
    season: { tvdb: 4 },
    episode_offset: { tvdb: 16 },
  },
])["tt2560140"];

/** One Piece: a single MAL-absolute entry — no season field at all. */
const ONE_PIECE = buildIndex([
  { imdb_id: ["tt0388629"], mal_id: 21, type: "TV" },
])["tt0388629"];

const season = (n: number, ids: string[]): Season => ({
  id: `s${n}`,
  number: n,
  name: n === 0 ? "Specials" : `Season ${n}`,
  episodes: ids.map((id, i) => ({ id, number: i + 1, title: `E${i + 1}` })),
});

describe("buildIndex", () => {
  it("indexes rows under every imdb id and drops mal-less rows", () => {
    expect(AOT).toHaveLength(6); // the OVA row had no mal_id
    expect(ONE_PIECE).toEqual([[21, null, 0, "TV"]]);
  });
});

describe("resolveMal — per-season entries", () => {
  it("maps a plain season to its MAL entry, episode unchanged", () => {
    expect(resolveMal(AOT, 2, 5, "tt2560140:2:5", [])).toEqual({
      mal: 25777,
      ep: 5,
    });
  });

  it("splits cours by the largest offset below the episode", () => {
    // S3E12 is still the first cour; S3E13 starts mal 38524 at ep 1.
    expect(resolveMal(AOT, 3, 12, "tt2560140:3:12", [])).toEqual({
      mal: 35760,
      ep: 12,
    });
    expect(resolveMal(AOT, 3, 13, "tt2560140:3:13", [])).toEqual({
      mal: 38524,
      ep: 1,
    });
    expect(resolveMal(AOT, 4, 17, "tt2560140:4:17", [])).toEqual({
      mal: 48583,
      ep: 1,
    });
  });

  it("returns null for an unmapped season", () => {
    expect(resolveMal(AOT, 9, 1, "tt2560140:9:1", [])).toBeNull();
  });
});

describe("resolveMal — MAL-absolute entries (One Piece class)", () => {
  const seasons = [
    season(0, ["tt0388629:0:1"]), // specials never count
    season(1, ["tt0388629:1:1", "tt0388629:1:2", "tt0388629:1:3"]),
    season(2, ["tt0388629:2:4", "tt0388629:2:5"]),
  ];

  it("uses the episode's position across non-special seasons", () => {
    expect(resolveMal(ONE_PIECE, 2, 5, "tt0388629:2:5", seasons)).toEqual({
      mal: 21,
      ep: 5,
    });
  });

  it("returns null when the episode isn't in the list", () => {
    expect(resolveMal(ONE_PIECE, 3, 9, "tt0388629:3:9", seasons)).toBeNull();
  });
});

describe("resolveMal — movies", () => {
  const rows = buildIndex([
    { imdb_id: "tt5311514", mal_id: 32281, type: "MOVIE" },
  ])["tt5311514"];

  it("maps a lone movie row to episode 1", () => {
    expect(resolveMal(rows, null, null, null, [])).toEqual({
      mal: 32281,
      ep: 1,
    });
  });

  it("refuses ambiguity (two movie rows)", () => {
    const two = [...rows, ...rows];
    expect(resolveMal(two, null, null, null, [])).toBeNull();
  });
});

describe("absoluteEpisode", () => {
  it("counts across seasons in number order, skipping specials", () => {
    const seasons = [
      season(2, ["b1", "b2"]),
      season(0, ["x"]),
      season(1, ["a1", "a2", "a3"]),
    ];
    expect(absoluteEpisode(seasons, "a1")).toBe(1);
    expect(absoluteEpisode(seasons, "b2")).toBe(5);
    expect(absoluteEpisode(seasons, "nope")).toBeNull();
  });
});

describe("looksAnime", () => {
  it("gates on an animation-ish genre", () => {
    expect(looksAnime({ genres: ["Action", "Animation"] })).toBe(true);
    expect(looksAnime({ genres: ["Anime"] })).toBe(true);
    expect(looksAnime({ genres: ["Drama"] })).toBe(false);
    expect(looksAnime({ genres: [] })).toBe(false);
  });
});

/** A real double from the dataset (tt0447582, season 2): an OVA and a TV
 * entry on the same season and offset. */
const DOUBLE = buildIndex([
  { imdb_id: "tt0447582", mal_id: 5147, type: "OVA", season: { tvdb: 2 } },
  { imdb_id: "tt0447582", mal_id: 706, type: "TV", season: { tvdb: 2 } },
  { imdb_id: "tt0447582", mal_id: 700, type: "OVA", season: { tvdb: 3 } },
  { imdb_id: "tt0447582", mal_id: 701, type: "OVA", season: { tvdb: 3 } },
  { imdb_id: "tt0447582", mal_id: 800, type: "TV", season: { tvdb: 4 } },
  { imdb_id: "tt0447582", mal_id: 801, type: "TV", season: { tvdb: 4 } },
])["tt0447582"];

describe("resolveMal — two entries on one season (strict, for a write)", () => {
  it("takes the TV entry when it is the only TV one", () => {
    expect(resolveMal(DOUBLE, 2, 3, "tt0447582:2:3", [], true)).toEqual({
      mal: 706,
      ep: 3,
    });
  });

  it("places nothing when no entry, or more than one, is TV", () => {
    expect(resolveMal(DOUBLE, 3, 1, "tt0447582:3:1", [], true)).toBeNull();
    expect(resolveMal(DOUBLE, 4, 1, "tt0447582:4:1", [], true)).toBeNull();
  });

  it("leaves skip times as they were: the first row", () => {
    expect(resolveMal(DOUBLE, 2, 3, "tt0447582:2:3", [])).toEqual({
      mal: 5147,
      ep: 3,
    });
    expect(resolveMal(DOUBLE, 3, 1, "tt0447582:3:1", [])).toEqual({
      mal: 700,
      ep: 1,
    });
  });

  it("keeps split cours apart: different offsets are not a tie", () => {
    expect(resolveMal(AOT, 3, 13, "tt2560140:3:13", [], true)).toEqual({
      mal: 38524,
      ep: 1,
    });
  });
});

describe("buildKitsuIndex", () => {
  it("pairs Kitsu ids with MAL ids and skips rows missing either", () => {
    expect(
      buildKitsuIndex([
        { kitsu_id: 1376, mal_id: 1535 },
        { kitsu_id: 7442 },
        { mal_id: 21 },
      ]),
    ).toEqual({ 1376: 1535 });
  });
});

const IDX: AnimeIndexes = {
  imdb: { tt2560140: AOT, tt0388629: ONE_PIECE, tt0447582: DOUBLE },
  kitsu: { 1376: 1535 },
};

describe("malEpisodeOf", () => {
  it("takes a Kitsu episode's number straight across", () => {
    expect(malEpisodeOf("kitsu:1376", "kitsu:1376:5", [], IDX)).toEqual({
      mal: 1535,
      ep: 5,
    });
    // A one-video entry plays as the title's own id.
    expect(malEpisodeOf("kitsu:1376", "kitsu:1376", [], IDX)).toEqual({
      mal: 1535,
      ep: 1,
    });
  });

  it("places nothing for an unknown Kitsu title or someone else's episode", () => {
    expect(malEpisodeOf("kitsu:9", "kitsu:9:1", [], IDX)).toBeNull();
    expect(malEpisodeOf("kitsu:1376", "kitsu:13760:1", [], IDX)).toBeNull();
    expect(malEpisodeOf("kitsu:1376", "kitsu:1376:1", [], { imdb: null, kitsu: null })).toBeNull();
  });

  it("maps IMDb episodes under the strict rule", () => {
    expect(malEpisodeOf("tt2560140", "tt2560140:3:13", [], IDX)).toEqual({
      mal: 38524,
      ep: 1,
    });
    expect(malEpisodeOf("tt0447582", "tt0447582:2:3", [], IDX)).toEqual({
      mal: 706,
      ep: 3,
    });
    expect(malEpisodeOf("tt0447582", "tt0447582:3:1", [], IDX)).toBeNull();
    expect(malEpisodeOf("tt9999999", "tt9999999:1:1", [], IDX)).toBeNull();
  });
});

describe("malWatchedEpisodes", () => {
  it("ticks each cour up to its entry's count", () => {
    const s3 = season(3, Array.from({ length: 24 }, (_, i) => `tt2560140:3:${i + 1}`));
    const got = malWatchedEpisodes("tt2560140", [s3], IDX, new Map([
      [35760, 12],
      [38524, 3],
    ]));
    expect(got).toEqual([...Array.from({ length: 15 }, (_, i) => `tt2560140:3:${i + 1}`)]);
  });

  it("counts a MAL-absolute entry across seasons, specials aside", () => {
    const seasons = [
      season(0, ["tt0388629:0:1"]),
      season(1, ["tt0388629:1:1", "tt0388629:1:2", "tt0388629:1:3"]),
      season(2, ["tt0388629:2:4", "tt0388629:2:5"]),
    ];
    expect(malWatchedEpisodes("tt0388629", seasons, IDX, new Map([[21, 4]]))).toEqual([
      "tt0388629:1:1",
      "tt0388629:1:2",
      "tt0388629:1:3",
      "tt0388629:2:4",
    ]);
  });

  it("reads the TV entry's count on a double, never the OVA's", () => {
    const s2 = season(2, ["tt0447582:2:1", "tt0447582:2:2", "tt0447582:2:3"]);
    expect(malWatchedEpisodes("tt0447582", [s2], IDX, new Map([[5147, 3]]))).toEqual([]);
    expect(malWatchedEpisodes("tt0447582", [s2], IDX, new Map([[706, 2]]))).toEqual([
      "tt0447582:2:1",
      "tt0447582:2:2",
    ]);
  });

  it("ticks Kitsu episodes by number", () => {
    const s1 = season(1, ["kitsu:1376:1", "kitsu:1376:2", "kitsu:1376:3"]);
    expect(malWatchedEpisodes("kitsu:1376", [s1], IDX, new Map([[1535, 2]]))).toEqual([
      "kitsu:1376:1",
      "kitsu:1376:2",
    ]);
  });
});

describe("malFilmOf", () => {
  const films = buildIndex([
    { imdb_id: "tt5311514", mal_id: 32281, type: "MOVIE" },
    { imdb_id: "tt5311514", mal_id: 34000, type: "SPECIAL" },
    { imdb_id: "tt0000002", mal_id: 1, type: "MOVIE" },
    { imdb_id: "tt0000002", mal_id: 2, type: "MOVIE" },
  ]);
  const idx: AnimeIndexes = { imdb: films, kitsu: { 1376: 1535 } };

  it("takes a film's one MOVIE entry, episode 1, beside other kinds", () => {
    expect(malFilmOf("tt5311514", idx)).toEqual({ mal: 32281, ep: 1 });
  });

  it("places nothing when two entries are films, or none is known", () => {
    expect(malFilmOf("tt0000002", idx)).toBeNull();
    expect(malFilmOf("tt9999999", idx)).toBeNull();
    expect(malFilmOf("kitsu:9", idx)).toBeNull();
  });

  it("takes a Kitsu film straight across", () => {
    expect(malFilmOf("kitsu:1376", idx)).toEqual({ mal: 1535, ep: 1 });
  });
});
