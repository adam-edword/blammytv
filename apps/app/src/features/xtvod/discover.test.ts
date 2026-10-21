import { describe, expect, it } from "vitest";
import { feedOf, PAGE, pageOf, SEARCH_CAP, searchTitles } from "./discover";
import { MOVIE_4K, MOVIE_FOLDERS, SHOW, SHOW_FOLDERS } from "./fixture";
import { buildLibrary, type XtLists } from "./library";
import { readMovies, readShows } from "./read";

const movie = (stream_id: number, name: string, category_id: string, extra: Record<string, unknown> = {}) => ({
  ...MOVIE_4K,
  stream_id,
  name,
  category_id,
  tmdb_id: 900000 + stream_id,
  added: String(1700000000 + stream_id),
  ...extra,
});
const show = (series_id: number, name: string, category_id: string, extra: Record<string, unknown> = {}) => ({
  ...SHOW,
  series_id,
  name,
  category_id,
  tmdb_id: 800000 + series_id,
  last_modified: String(1700000000 + series_id),
  ...extra,
});

const lists = (movies: unknown[], shows: unknown[] = []): XtLists => ({
  movies: readMovies(movies),
  shows: readShows(shows),
  movieFolders: MOVIE_FOLDERS,
  showFolders: SHOW_FOLDERS,
});
const lib = (movies: unknown[], shows: unknown[] = []) => buildLibrary("t", lists(movies, shows), true);
const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe("the feed", () => {
  it("is every title of the kind in the whole library, newest first, whichever folder it sits in", () => {
    const l = lib(
      [movie(10, "Old One (2001)", "11"), movie(30, "Newest (2024)", "13"), movie(20, "Middle (2010)", "12"), movie(25, "In No Folder (2012)", "99")],
      [show(40, "A Show (2020)", "12")],
    );
    expect(titles(feedOf(l, "movie").map((t) => t.item))).toEqual(["Newest", "In No Folder", "Middle", "Old One"]);
    expect(titles(feedOf(l, "series").map((t) => t.item))).toEqual(["A Show"]);
  });

  it("dates a title by its newest copy, and holds the two copies once", () => {
    const l = lib([
      movie(10, "Other (2020)", "12", { added: "1750000000" }),
      { ...MOVIE_4K, stream_id: 11, name: "4K Twin (2022)", tmdb_id: 5, added: "1740000000", category_id: "11" },
      { ...MOVIE_4K, stream_id: 12, name: "Twin (2022)", tmdb_id: 5, added: "1760000000", category_id: "12" },
    ]);
    expect(titles(feedOf(l, "movie").map((t) => t.item))).toEqual(["Twin", "Other"]);
  });

  it("keeps the panel's order for titles added together", () => {
    const same = { added: "1750000000" };
    const l = lib([movie(10, "First (2020)", "12", same), movie(11, "Second (2020)", "12", same), movie(12, "Third (2020)", "12", same)]);
    expect(titles(feedOf(l, "movie").map((t) => t.item))).toEqual(["First", "Second", "Third"]);
  });

  it("is empty for a kind the library has none of", () => {
    expect(feedOf(lib([movie(10, "Only Film (2020)", "12")]), "series")).toEqual([]);
    expect(feedOf(lib([], [show(40, "Only Show (2020)", "12")]), "movie")).toEqual([]);
  });

  it("leaves out what the adult filter leaves out of the library", () => {
    const l = lib([movie(10, "Fine (2020)", "12"), movie(11, "Flagged (2020)", "12", { is_adult: 1 })]);
    expect(titles(feedOf(l, "movie").map((t) => t.item))).toEqual(["Fine"]);
  });

  it("is sorted once per build of the library", () => {
    const l = lib([movie(10, "A (2020)", "12")]);
    expect(feedOf(l, "movie")).toBe(feedOf(l, "movie"));
  });
});

describe("a page of the feed", () => {
  const many = lib(Array.from({ length: PAGE * 2 + 5 }, (_, i) => movie(100 + i, `Film ${String(i).padStart(3, "0")} (2020)`, "12")));
  const feed = feedOf(many, "movie");

  it("is fifty cards, then fifty, then the rest, then nothing", () => {
    const a = pageOf(feed, 0);
    const b = pageOf(feed, PAGE);
    const c = pageOf(feed, PAGE * 2);
    expect([a.length, b.length, c.length]).toEqual([PAGE, PAGE, 5]);
    expect(pageOf(feed, PAGE * 2 + 5)).toEqual([]);
    expect(pageOf(feed, 9999)).toEqual([]);
  });

  it("is the library's own cards, newest first, with no title twice", () => {
    const all = [0, PAGE, PAGE * 2].flatMap((skip) => pageOf(feed, skip));
    expect(all).toEqual(feed.map((t) => t.item));
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    expect(all[0].title).toBe("Film 104");
    expect(all.every((i) => i.from === "xt")).toBe(true);
  });

  it("reads a skip that is not a whole number or is negative as the start", () => {
    expect(pageOf(feed, -3)).toEqual(pageOf(feed, 0));
    expect(pageOf(feed, 0.9)).toEqual(pageOf(feed, 0));
  });
});

describe("search", () => {
  const l = lib(
    [
      movie(10, "Quiet Harbor (2020)", "13"),
      movie(11, "The Quiet Harbor Returns (2022)", "12"),
      movie(12, "Amélie (2001)", "12"),
      movie(13, "Harbor Lights (2019)", "11"),
      movie(14, "Unrelated (2018)", "12"),
    ],
    [show(40, "Quiet Harbour Nights (2021)", "12"), show(41, "Amélie: The Series (2023)", "13")],
  );

  it("finds a title in a folder no one picked, whatever the case", () => {
    expect(titles(searchTitles([l], "movie", "QUIET harbor"))).toContain("Quiet Harbor");
    expect(titles(searchTitles([l], "movie", "quiet harbor"))).toEqual(["Quiet Harbor", "The Quiet Harbor Returns"]);
  });

  it("ignores accents on either side", () => {
    expect(titles(searchTitles([l], "movie", "amelie"))).toEqual(["Amélie"]);
    expect(titles(searchTitles([l], "movie", "AMÉLIE"))).toEqual(["Amélie"]);
    expect(titles(searchTitles([lib([movie(10, "Amelie (2001)", "12")])], "movie", "amélie"))).toEqual(["Amelie"]);
  });

  it("puts the title that starts with the query before the one that only holds it, and the newer of two that tie first", () => {
    expect(titles(searchTitles([l], "movie", "harbor"))).toEqual(["Harbor Lights", "The Quiet Harbor Returns", "Quiet Harbor"]);
  });

  it("is a search of one kind: a movie's search finds no show, a show's no movie", () => {
    expect(titles(searchTitles([l], "series", "quiet"))).toEqual(["Quiet Harbour Nights"]);
    expect(titles(searchTitles([l], "series", "amelie"))).toEqual(["Amélie: The Series"]);
    expect(titles(searchTitles([l], "movie", "nights"))).toEqual([]);
  });

  it("drops what does not match", () => {
    expect(searchTitles([l], "movie", "zzzz")).toEqual([]);
    expect(searchTitles([l], "movie", "!!")).toEqual([]);
  });

  it("gives at most fifty a kind, the best fifty", () => {
    const big = lib([
      ...Array.from({ length: 70 }, (_, i) => movie(100 + i, `Saga Part ${i} (2020)`, "12")),
      movie(500, "Saga (2020)", "12", { added: "1600000000" }),
    ]);
    const got = searchTitles([big], "movie", "saga");
    expect(got).toHaveLength(SEARCH_CAP);
    // The exact title is the oldest of 71, and still leads.
    expect(got[0].title).toBe("Saga");
  });

  it("searches every library it is given and ranks them as one list", () => {
    const other = buildLibrary("u", lists([movie(10, "Quiet Harbor Too (2020)", "12"), movie(11, "Harbor (2020)", "12")]), true);
    const got = searchTitles([l, other], "movie", "harbor");
    expect(got.map((i) => [i.title, i.id.split(":")[1]])).toEqual([
      ["Harbor", "u"],
      ["Harbor Lights", "t"],
      // These three hold it and tie: each library's newest first, in library order.
      ["The Quiet Harbor Returns", "t"],
      ["Quiet Harbor", "t"],
      ["Quiet Harbor Too", "u"],
    ]);
  });

  it("searches nothing when there is no library to search", () => {
    expect(searchTitles([], "movie", "harbor")).toEqual([]);
  });
});
