import { describe, expect, it } from "vitest";
import { buildLibrary, leftOut, type XtLists } from "./library";
import { readMovies, readShows } from "./read";
import { MOVIE_4K, MOVIE_HD, MOVIE_FOLDERS, SHOW, SHOW_4K, SHOW_FOLDERS } from "./fixture";

const movie = (stream_id: number, name: string, category_id: string, extra: Record<string, unknown> = {}) => ({
  ...MOVIE_4K,
  stream_id,
  name,
  category_id,
  tmdb_id: 900000 + stream_id,
  ...extra,
});
const show = (series_id: number, name: string, category_id: string, extra: Record<string, unknown> = {}) => ({
  ...SHOW,
  series_id,
  name,
  category_id,
  tmdb_id: 800000 + series_id,
  ...extra,
});

/** A list as the panel sends it, read, with folders. Movie folders 11 to 13 and
 * show folders 12 and 13 (they share two ids). */
const lists = (movies: unknown[], shows: unknown[] = []): XtLists => ({
  movies: readMovies(movies),
  shows: readShows(shows),
  movieFolders: MOVIE_FOLDERS,
  showFolders: SHOW_FOLDERS,
});

const keysOf = (folders: { id: string; keys: string[] }[], id: string) => folders.find((f) => f.id === id)?.keys;

describe("one title, two copies", () => {
  const lib = buildLibrary("t", lists([MOVIE_HD, MOVIE_4K]), true);
  const key = "xt:t:m:t617126";

  it("is one item, however many copies the panel lists", () => {
    expect([...lib.titles.keys()]).toEqual([key]);
    const t = lib.titles.get(key)!;
    expect(t.kind).toBe("movie");
    expect(t.copies.map((c) => c.id)).toEqual(["52114", "52390"]); // the 4K one first
  });

  it("is drawn from the best copy, from the xt source, under its key", () => {
    const { item } = lib.titles.get(key)!;
    expect(item).toMatchObject({
      id: key,
      from: "xt",
      title: "The Fantastic 4: First Steps",
      kind: "movie",
      year: 2025,
      poster: MOVIE_4K.stream_icon,
      rating: 7.2,
      genres: [],
      cast: [],
      seasons: [],
    });
  });

  it("is the same item whichever order the panel lists the copies in", () => {
    const flipped = buildLibrary("t", lists([MOVIE_4K, MOVIE_HD]), true).titles.get(key)!;
    const t = lib.titles.get(key)!;
    expect(flipped.item).toEqual(t.item);
    expect(flipped.copies.map((c) => c.id)).toEqual(t.copies.map((c) => c.id));
  });

  it("reads a field the best copy lacks from the next one that has it", () => {
    const bare = { ...MOVIE_4K, stream_icon: "", rating: "0", rating_5based: 0 };
    const t = buildLibrary("t", lists([bare, MOVIE_HD]), true).titles.get(key)!;
    expect(t.copies[0].id).toBe("52114");
    expect(t.item.poster).toBe(MOVIE_HD.stream_icon);
    expect(t.item.rating).toBe(7.2);
  });

  it("is as new as its newest copy", () => {
    expect(lib.titles.get(key)!.added).toBe(1753833600);
  });

  it("belongs to the folder of each copy, once, in the panel's order", () => {
    expect(keysOf(lib.movieFolders, "11")).toEqual([key]);
    expect(keysOf(lib.movieFolders, "12")).toEqual([key]);
    expect(keysOf(lib.movieFolders, "13")).toEqual([]);
  });
});

describe("a title with no TMDB id", () => {
  const none = { ...movie(3003, "Home Movie Night (2019)", "13"), tmdb_id: undefined };
  const zero = movie(3004, "Kitchen Sink Story (2021)", "12", { tmdb_id: 0 });
  const lib = buildLibrary("t", lists([none, zero]), true);

  it("is keyed by its stream id and is a title of its own", () => {
    expect([...lib.titles.keys()]).toEqual(["xt:t:m:3003", "xt:t:m:3004"]);
  });

  it("is never folded with another that has none, even by the same name", () => {
    const twin = buildLibrary("t", lists([none, { ...none, stream_id: 3999 }]), true);
    expect([...twin.titles.keys()]).toEqual(["xt:t:m:3003", "xt:t:m:3999"]);
  });
});

describe("the folders", () => {
  const rows = [
    movie(1, "A (2020)", "12"),
    movie(2, "B (2020)", "13"),
    movie(3, "C (2020)", "12"),
    movie(4, "D (2020)", "12"),
  ];
  const lib = buildLibrary("t", lists(rows), true);

  it("list their titles in the order the panel does", () => {
    expect(keysOf(lib.movieFolders, "12")).toEqual(["xt:t:m:t900001", "xt:t:m:t900003", "xt:t:m:t900004"]);
    expect(keysOf(lib.movieFolders, "13")).toEqual(["xt:t:m:t900002"]);
  });

  it("list a stream the panel files under two folders once in each, and its item once", () => {
    const twice = buildLibrary("t", lists([...rows, { ...rows[0], category_id: "13" }, { ...rows[0] }]), true);
    expect(twice.titles.size).toBe(4);
    expect(twice.titles.get("xt:t:m:t900001")!.copies).toHaveLength(1);
    expect(keysOf(twice.movieFolders, "12")!.filter((k) => k === "xt:t:m:t900001")).toHaveLength(1);
    expect(keysOf(twice.movieFolders, "13")).toEqual(["xt:t:m:t900002", "xt:t:m:t900001"]);
  });

  it("keep every folder the panel has, empty or not, in its order", () => {
    expect(lib.movieFolders.map((f) => [f.id, f.name])).toEqual([["11", "4K Movies"], ["12", "Action"], ["13", "Comedy"]]);
    expect(keysOf(lib.movieFolders, "11")).toEqual([]);
  });

  it("keep a movie folder and a show folder with one id apart", () => {
    const both = buildLibrary("t", lists(rows, [show(1, "Drama One (2020)", "12"), show(2, "Sitcom Two (2020)", "13")]), true);
    expect(keysOf(both.movieFolders, "12")).toEqual(["xt:t:m:t900001", "xt:t:m:t900003", "xt:t:m:t900004"]);
    expect(keysOf(both.showFolders, "12")).toEqual(["xt:t:s:t800001"]);
    expect(keysOf(both.showFolders, "13")).toEqual(["xt:t:s:t800002"]);
    expect(both.showFolders.map((f) => f.name)).toEqual(["Drama", "Sitcoms"]);
  });

  it("leave a title whose folder the panel did not list in the library and in no folder", () => {
    const orphan = buildLibrary("t", lists([movie(7, "Orphan (2020)", "99"), movie(8, "No Folder (2020)", "")]), true);
    expect([...orphan.titles.keys()]).toEqual(["xt:t:m:t900007", "xt:t:m:t900008"]);
    for (const f of orphan.movieFolders) expect(f.keys).toEqual([]);
  });
});

describe("shows", () => {
  const lib = buildLibrary("t", lists([], [SHOW, SHOW_4K]), true);
  const key = "xt:t:s:t4521";

  it("fold by TMDB id into one show with a copy each, the 4K one first", () => {
    expect([...lib.titles.keys()]).toEqual([key]);
    const t = lib.titles.get(key)!;
    expect(t.kind).toBe("series");
    expect(t.copies.map((c) => c.id)).toEqual(["3102", "3101"]);
  });

  it("are drawn with what the list says, and no seasons until the page opens", () => {
    expect(lib.titles.get(key)!.item).toMatchObject({
      id: key,
      from: "xt",
      kind: "series",
      title: "'Allo 'Allo!",
      year: 1984,
      poster: SHOW.cover,
      // The 4K copy has no backdrop; the next copy does.
      backdrop: SHOW.backdrop_path[0],
      synopsis: SHOW.plot,
      genres: ["Comedy", "War & Politics"],
      cast: ["Gorden Kaye", "Carmen Silvera", "Vicki Michelle"],
      runtimeMin: 30,
      seasons: [],
    });
  });

  it("belong to the folder of each copy", () => {
    expect(keysOf(lib.showFolders, "12")).toEqual([key]);
    expect(keysOf(lib.showFolders, "13")).toEqual([key]);
  });

  it("with no TMDB id are keyed by their series id", () => {
    const l = buildLibrary("t", lists([], [{ ...SHOW, tmdb_id: undefined }]), true);
    expect([...l.titles.keys()]).toEqual(["xt:t:s:3101"]);
  });

  it("with the same number as a movie's are a different title", () => {
    const l = buildLibrary("t", lists([movie(5, "M (2020)", "12", { tmdb_id: 77 })], [show(5, "S (2020)", "12", { tmdb_id: 77 })]), true);
    expect([...l.titles.keys()].sort()).toEqual(["xt:t:m:t77", "xt:t:s:t77"]);
  });
});

describe("the adult rule", () => {
  const adultFolders = [
    ...MOVIE_FOLDERS,
    { id: "14", name: "Premium Vault", adult: true }, // flagged by the panel, an innocent name
    { id: "15", name: "XXX Movies", adult: false }, // caught by its name
    { id: "16", name: "Adult Swim", adult: false }, // the false positive that stays
  ];
  const rows = [
    movie(1, "Plain (2020)", "12"),
    movie(2, "Flagged Title (2020)", "12", { is_adult: 1 }),
    movie(3, "In Flagged Folder (2020)", "14"),
    movie(4, "In Named Folder (2020)", "15"),
    movie(5, "In Adult Swim (2020)", "16"),
    movie(6, "Flagged As String (2020)", "13", { is_adult: "1" }),
  ];
  const all: XtLists = { movies: readMovies(rows), shows: [], movieFolders: adultFolders, showFolders: [] };
  const names = (hide: boolean) => [...buildLibrary("t", all, hide).titles.values()].map((t) => t.item.title);

  it("leaves out a title the panel flags, in an ordinary folder", () => {
    expect(names(true)).not.toContain("Flagged Title");
    expect(names(true)).not.toContain("Flagged As String");
  });

  it("leaves out every title in a folder the panel flags, however innocent its name", () => {
    expect(names(true)).not.toContain("In Flagged Folder");
  });

  it("leaves out every title in a folder whose name says so", () => {
    expect(names(true)).not.toContain("In Named Folder");
  });

  it("keeps Adult Swim, and the plain title", () => {
    expect(names(true)).toEqual(["Plain", "In Adult Swim"]);
  });

  it("drops the adult folders themselves from the list, and keeps the rest", () => {
    const lib = buildLibrary("t", all, true);
    expect(lib.movieFolders.map((f) => f.name)).toEqual(["4K Movies", "Action", "Comedy", "Adult Swim"]);
    expect(keysOf(lib.movieFolders, "12")).toEqual(["xt:t:m:t900001"]);
  });

  it("leaves nothing out when adult content is shown", () => {
    expect(names(false)).toEqual([
      "Plain",
      "Flagged Title",
      "In Flagged Folder",
      "In Named Folder",
      "In Adult Swim",
      "Flagged As String",
    ]);
    expect(buildLibrary("t", all, false).movieFolders).toHaveLength(6);
  });

  it("is run on each copy, so a title keeps the copies that are not adult", () => {
    const pair = readMovies([
      movie(10, "4K Pair (2020)", "14", { tmdb_id: 55 }),
      movie(11, "Pair (2020)", "12", { tmdb_id: 55 }),
    ]);
    const lib = buildLibrary("t", { movies: pair, shows: [], movieFolders: adultFolders, showFolders: [] }, true);
    expect(lib.titles.get("xt:t:m:t55")!.copies.map((c) => c.id)).toEqual(["11"]);
    expect(keysOf(lib.movieFolders, "12")).toEqual(["xt:t:m:t55"]);
  });

  it("leaves out an adult show, and a show in an adult show folder", () => {
    const l = buildLibrary(
      "t",
      {
        movies: [],
        shows: readShows([show(1, "Flagged Show (2020)", "21", { is_adult: 1 }), show(2, "In Adult Folder (2020)", "22"), show(3, "Fine (2020)", "21")]),
        movieFolders: [],
        showFolders: [{ id: "21", name: "Drama", adult: false }, { id: "22", name: "XXX Series", adult: false }],
      },
      true,
    );
    expect([...l.titles.values()].map((t) => t.item.title)).toEqual(["Fine"]);
    expect(l.showFolders.map((f) => f.name)).toEqual(["Drama"]);
  });
});

describe("leftOut", () => {
  const ordinary = { id: "1", name: "Action", adult: false };
  it("is the whole rule: a flagged title or an adult folder, while adult content is hidden", () => {
    expect(leftOut(true, ordinary, true)).toBe(true);
    expect(leftOut(false, { ...ordinary, adult: true }, true)).toBe(true);
    expect(leftOut(false, { ...ordinary, name: "XXX" }, true)).toBe(true);
    expect(leftOut(false, ordinary, true)).toBe(false);
    expect(leftOut(false, undefined, true)).toBe(false);
    expect(leftOut(true, undefined, true)).toBe(true);
  });
  it("never leaves anything out when adult content is shown", () => {
    expect(leftOut(true, { ...ordinary, adult: true }, false)).toBe(false);
    expect(leftOut(true, undefined, false)).toBe(false);
  });
});
