import { describe, expect, it } from "vitest";
import {
  extOf,
  firstWeb,
  idOf,
  num,
  orderCopies,
  posInt,
  rating10,
  readMovies,
  readShows,
  splitList,
  yearOf,
  type XtMovie,
} from "./read";
import { MOVIE_4K, MOVIE_HD, SHOW } from "./fixture";

describe("the coercions", () => {
  it("read a number sent as a number or as a string", () => {
    expect(num(5)).toBe(5);
    expect(num("5")).toBe(5);
    expect(num(" 7.5 ")).toBe(7.5);
    for (const v of ["", " ", "abc", null, undefined, {}, [], true, NaN, Infinity]) expect(num(v), String(v)).toBeUndefined();
  });

  it("let a positive whole number through and nothing else", () => {
    expect(posInt("617126")).toBe(617126);
    expect(posInt(617126)).toBe(617126);
    for (const v of [0, "0", -3, "-3", 1.5, "1.5", "", null, "12abc"]) expect(posInt(v), String(v)).toBeUndefined();
  });

  it("let a panel id through only as plain digits, which go into an address and a key", () => {
    expect(idOf(52114)).toBe("52114");
    expect(idOf("52114")).toBe("52114");
    for (const v of [0, "0", "007", "12:3", "../1", "1 2", -1, 1.5, null, undefined, ""]) expect(idOf(v), String(v)).toBeUndefined();
  });

  it("read the extension a file's address ends in, and nothing that could change the address", () => {
    expect(extOf("mkv")).toBe("mkv");
    expect(extOf(".MP4")).toBe("mp4");
    for (const v of ["", "m3u8/../x", "mkv?x=1", "a", "toolong", null, 5]) expect(extOf(v), String(v)).toBe("");
  });

  it("read a rating out of 10, from the rating or the five-star one doubled", () => {
    expect(rating10({ rating: "7.2" })).toBe(7.2);
    expect(rating10({ rating: 7.25 })).toBe(7.3);
    expect(rating10({ rating: "0", rating_5based: 3.35 })).toBe(6.7);
    expect(rating10({ rating_5based: "4" })).toBe(8);
    expect(rating10({ rating: "72", rating_5based: 3.6 })).toBe(7.2); // out of 100 is not a rating
    for (const o of [{}, { rating: "0" }, { rating: "" }, { rating: "abc" }, { rating_5based: 9 }]) expect(rating10(o), JSON.stringify(o)).toBeUndefined();
  });

  it("split a list on commas, and cap it", () => {
    expect(splitList("Comedy, War & Politics")).toEqual(["Comedy", "War & Politics"]);
    expect(splitList(" a ,, b ,")).toEqual(["a", "b"]);
    expect(splitList("")).toEqual([]);
    expect(splitList(null)).toEqual([]);
    expect(splitList(Array.from({ length: 30 }, (_, i) => `n${i}`).join(", "))).toHaveLength(20);
  });

  it("take the first address of a backdrop list, or the bare string some panels send", () => {
    expect(firstWeb(["", "ftp://x/y.jpg", "https://a/b.jpg", "https://c/d.jpg"])).toBe("https://a/b.jpg");
    expect(firstWeb("http://a/b.jpg")).toBe("http://a/b.jpg");
    expect(firstWeb([])).toBeUndefined();
    expect(firstWeb("")).toBeUndefined();
    expect(firstWeb(null)).toBeUndefined();
  });

  it("take a year from a date's first four digits, when that is a year", () => {
    expect(yearOf("1984-09-07")).toBe(1984);
    expect(yearOf("")).toBeUndefined();
    expect(yearOf("0000-00-00")).toBeUndefined();
    expect(yearOf("soon")).toBeUndefined();
  });
});

describe("the movie list", () => {
  it("reads the real entry field for field", () => {
    expect(readMovies([MOVIE_4K])).toEqual([
      {
        id: "52114",
        name: "4K The Fantastic 4: First Steps (2025)",
        title: "The Fantastic 4: First Steps",
        year: 2025,
        quality: "4K",
        tmdb: 617126,
        poster: MOVIE_4K.stream_icon,
        rating: 7.2,
        added: 1753228800,
        adult: false,
        folderId: "11",
        ext: "mkv",
      },
    ]);
  });

  it("reads numbers sent as strings and strings sent as numbers", () => {
    const [m] = readMovies([
      { ...MOVIE_4K, stream_id: "52114", tmdb_id: "617126", added: 1753228800, category_id: 11, rating: 7.2, is_adult: 0 },
    ]);
    expect(m).toMatchObject({ id: "52114", tmdb: 617126, added: 1753228800, folderId: "11", rating: 7.2, adult: false });
  });

  it("has no TMDB id when the field is missing, 0, empty or junk", () => {
    const base = { ...MOVIE_4K };
    delete (base as Partial<typeof MOVIE_4K>).tmdb_id;
    for (const tmdb_id of [undefined, 0, "0", "", null, "abc", -1, 12.5]) {
      const [m] = readMovies([{ ...base, ...(tmdb_id === undefined ? {} : { tmdb_id }) }]);
      expect(m.tmdb, String(tmdb_id)).toBeUndefined();
    }
  });

  it("reads `tmdb` as the TMDB id on a panel that spells it so, as a string too", () => {
    const base = { ...MOVIE_4K } as Record<string, unknown>;
    delete base.tmdb_id;
    expect(readMovies([{ ...base, tmdb: "98765" }])[0].tmdb).toBe(98765);
    expect(readMovies([{ ...base, tmdb: 98765 }])[0].tmdb).toBe(98765);
    // `tmdb_id` first when it holds one; `tmdb` when it holds none.
    expect(readMovies([{ ...base, tmdb_id: 111, tmdb: 222 }])[0].tmdb).toBe(111);
    expect(readMovies([{ ...base, tmdb_id: 0, tmdb: 222 }])[0].tmdb).toBe(222);
  });

  it("flags adult from the panel's flag, however it is typed", () => {
    for (const [v, adult] of [[1, true], ["1", true], [0, false], ["0", false], [null, false], [undefined, false], ["", false]] as const)
      expect(readMovies([{ ...MOVIE_4K, is_adult: v }])[0].adult, String(v)).toBe(adult);
  });

  it("leaves what it cannot use out, and keeps the order of the rest", () => {
    const list = readMovies([
      { ...MOVIE_4K, stream_id: 1, name: "One" },
      { ...MOVIE_4K, stream_id: undefined, name: "no id" },
      { ...MOVIE_4K, stream_id: 0, name: "id 0" },
      { ...MOVIE_4K, stream_id: 3, name: "" },
      { ...MOVIE_4K, stream_id: 4, name: "no extension", container_extension: "" },
      { ...MOVIE_4K, stream_id: 5, name: "bad extension", container_extension: "../x" },
      null,
      "junk",
      [],
      { ...MOVIE_4K, stream_id: 9, name: "Nine" },
    ]);
    expect(list.map((m) => m.title)).toEqual(["One", "Nine"]);
  });

  it("is empty for anything that is not a list", () => {
    for (const v of [null, undefined, {}, "[]", 5, { error: "x" }]) expect(readMovies(v)).toEqual([]);
  });

  it("makes the fields it has no value for absent, not undefined or zero", () => {
    const [m] = readMovies([{ stream_id: 7, name: "Bare", container_extension: "mp4" }]);
    expect(m).toEqual({ id: "7", name: "Bare", title: "Bare", quality: null, added: 0, adult: false, folderId: "", ext: "mp4" });
    expect("tmdb" in m).toBe(false);
    expect("poster" in m).toBe(false);
  });

  it("takes only a web address for a poster", () => {
    expect(readMovies([{ ...MOVIE_4K, stream_icon: "file:///c/x.png" }])[0].poster).toBeUndefined();
    expect(readMovies([{ ...MOVIE_4K, stream_icon: "" }])[0].poster).toBeUndefined();
  });
});

describe("the show list", () => {
  it("reads the real entry field for field", () => {
    expect(readShows([SHOW])).toEqual([
      {
        id: "3101",
        name: "'Allo 'Allo! (1984)",
        title: "'Allo 'Allo!",
        year: 1984,
        quality: null,
        tmdb: 4521,
        poster: SHOW.cover,
        rating: 8.1,
        added: 1700000000,
        adult: false,
        folderId: "13",
        backdrop: SHOW.backdrop_path[0],
        synopsis: "René runs a cafe in occupied France.",
        genres: ["Comedy", "War & Politics"],
        cast: ["Gorden Kaye", "Carmen Silvera", "Vicki Michelle"],
        runtimeMin: 30,
      },
    ]);
  });

  it("takes the first backdrop, and has none when the array is empty", () => {
    expect(readShows([{ ...SHOW, backdrop_path: ["https://a/1.jpg", "https://a/2.jpg"] }])[0].backdrop).toBe("https://a/1.jpg");
    expect(readShows([{ ...SHOW, backdrop_path: [] }])[0].backdrop).toBeUndefined();
    expect(readShows([{ ...SHOW, backdrop_path: undefined }])[0].backdrop).toBeUndefined();
  });

  it("takes the year from the name, else from the release date", () => {
    expect(readShows([{ ...SHOW, name: "Some Show", releaseDate: "1999-01-02" }])[0].year).toBe(1999);
    expect(readShows([{ ...SHOW, name: "Some Show (2001)", releaseDate: "1999-01-02" }])[0].year).toBe(2001);
    expect(readShows([{ ...SHOW, name: "Some Show", releaseDate: "" }])[0].year).toBeUndefined();
  });

  it("reads the id, the TMDB id and the run time from numbers or strings", () => {
    const [s] = readShows([{ ...SHOW, series_id: "3101", tmdb_id: "4521", episode_run_time: 30 }]);
    expect(s).toMatchObject({ id: "3101", tmdb: 4521, runtimeMin: 30 });
    expect(readShows([{ ...SHOW, tmdb_id: 0 }])[0].tmdb).toBeUndefined();
    expect(readShows([{ ...SHOW, episode_run_time: "" }])[0].runtimeMin).toBeUndefined();
  });

  it("leaves out an entry with no id or name", () => {
    expect(readShows([{ ...SHOW, series_id: null }, { ...SHOW, name: "" }, SHOW])).toHaveLength(1);
    expect(readShows("nope")).toEqual([]);
  });
});

describe("the order of a title's copies", () => {
  const copy = (id: string, quality: XtMovie["quality"]): XtMovie => ({
    id, name: id, title: "T", quality, added: 0, adult: false, folderId: "", ext: "mkv",
  });

  it("is best quality first, an untagged name with HD, then the lower panel id", () => {
    const sorted = orderCopies([copy("9", "SD"), copy("20", null), copy("10", "FHD"), copy("3", "HD"), copy("30", "4K"), copy("11", "HDR")]);
    expect(sorted.map((c) => c.id)).toEqual(["30", "11", "10", "3", "20", "9"]);
  });

  it("does not depend on the order the panel listed them in", () => {
    const [a, b, c] = [copy("5", "4K"), copy("100", "4K"), copy("6", null)];
    const want = ["5", "100", "6"];
    for (const p of [[a, b, c], [c, b, a], [b, c, a], [b, a, c]]) expect(orderCopies(p).map((x) => x.id)).toEqual(want);
  });

  it("returns a new array and leaves the copies alone", () => {
    const list = [copy("2", null), copy("1", "4K")];
    const out = orderCopies(list);
    expect(out).not.toBe(list);
    expect(list.map((c) => c.id)).toEqual(["2", "1"]);
  });

  it("is what the real pair sorts to", () => {
    const [hd, k4] = readMovies([MOVIE_HD, MOVIE_4K]);
    expect(orderCopies([hd, k4]).map((c) => c.id)).toEqual(["52114", "52390"]);
  });
});
