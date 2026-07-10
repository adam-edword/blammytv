import { describe, expect, it } from "vitest";
import {
  absoluteEpisode,
  buildIndex,
  looksAnime,
  resolveMal,
} from "./aniskip";
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
