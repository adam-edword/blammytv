import { describe, expect, it } from "vitest";
import type { VodItem } from "../stream/model";
import { buildLibrary } from "./library";
import { movieFromInfo, showFromInfos } from "./pages";
import { readMovies, readShows } from "./read";
import { episodeTitle, readSeriesInfo } from "./series";
import {
  MOVIE_4K,
  MOVIE_FOLDERS,
  MOVIE_HD,
  SERIES_INFO,
  SERIES_INFO_4K,
  SHOW,
  SHOW_4K,
  SHOW_FOLDERS,
  VOD_INFO,
} from "./fixture";

const lib = buildLibrary(
  "t",
  { movies: readMovies([MOVIE_4K, MOVIE_HD]), shows: readShows([SHOW, SHOW_4K]), movieFolders: MOVIE_FOLDERS, showFolders: SHOW_FOLDERS },
  true,
);
const movieCard = lib.titles.get("xt:t:m:t617126")!.item;
const showTitle = lib.titles.get("xt:t:s:t4521")!;
if (showTitle.kind !== "series") throw new Error("the fixture's show is not a show");
const [show4k, showHd] = showTitle.copies; // the 4K copy first

describe("a movie's page", () => {
  const page = movieFromInfo(movieCard, VOD_INFO);

  it("is the card filled from the panel's info", () => {
    expect(page).toMatchObject({
      id: "xt:t:m:t617126",
      from: "xt",
      kind: "movie",
      title: "The Fantastic 4: First Steps",
      year: 2025,
      poster: MOVIE_4K.stream_icon,
      backdrop: VOD_INFO.info.backdrop,
      rating: 7.2,
      runtimeMin: 115,
      synopsis: "Four astronauts return to a changed Earth.",
      genres: ["Science Fiction", "Adventure"],
      cast: ["Pedro Pascal", "Vanessa Kirby", "Joseph Quinn", "Ebon Moss-Bachrach"],
      seasons: [],
    });
  });

  it("keeps the card's title, not the panel's name with its tag still in", () => {
    expect(page.title).not.toContain("4K");
  });

  it("takes the year from the release date over the name's", () => {
    const early = movieFromInfo(movieCard, { info: { ...VOD_INFO.info, releasedate: "2024-12-31" } });
    expect(early.year).toBe(2024);
  });

  it("reads the backdrop from the array when there is no bare one, and the runtime to the minute", () => {
    const p = movieFromInfo(movieCard, {
      info: { ...VOD_INFO.info, backdrop: "", backdrop_path: ["https://a/b.jpg"], duration_secs: "5430" },
    });
    expect(p.backdrop).toBe("https://a/b.jpg");
    expect(p.runtimeMin).toBe(91);
  });

  it("keeps what the card had for a field the info does not send", () => {
    const sparse = movieFromInfo(movieCard, { info: { name: "x" } });
    expect(sparse).toEqual(movieCard);
    const cast = movieFromInfo({ ...movieCard, cast: ["Kept"] }, { info: { ...VOD_INFO.info, cast: "" } });
    expect(cast.cast).toEqual(["Kept"]);
  });

  it("is the card itself for an answer with no info: an empty array, an empty info, junk", () => {
    for (const raw of [[], {}, { info: [] }, { info: [], movie_data: [] }, null, "x", 5]) expect(movieFromInfo(movieCard, raw), JSON.stringify(raw)).toBe(movieCard);
  });

  it("does not change the card it was given", () => {
    const before = JSON.stringify(movieCard);
    movieFromInfo(movieCard, VOD_INFO);
    expect(JSON.stringify(movieCard)).toBe(before);
  });
});

describe("one copy's series info", () => {
  const info = readSeriesInfo(showHd, SERIES_INFO);

  it("reads the episodes by season and number, with the panel's own episode id", () => {
    expect(info.episodes.map((e) => [e.season, e.number, e.id, e.ext])).toEqual([
      [1, 1, "186", "mkv"],
      [1, 2, "187", "mkv"],
      [1, 3, "188", "mkv"],
      [2, 1, "201", "mkv"],
      [2, 2, "202", "mkv"],
    ]);
    expect(info.episodes[0]).toMatchObject({ title: "Episode 1", airDate: "Sep 1, 1984", still: SHOW.cover });
  });

  it("titles an episode without the show's name and its S01E01, which the page already says", () => {
    const s = { name: "'Allo 'Allo! (1984)", title: "'Allo 'Allo!" };
    expect(episodeTitle("'Allo 'Allo! S01E01", s, 1)).toBe("Episode 1");
    expect(episodeTitle("'allo 'allo! s02e10", s, 10)).toBe("Episode 10");
    expect(episodeTitle("'Allo 'Allo! (1984) S01E03 - The Dance", s, 3)).toBe("The Dance");
    expect(episodeTitle("S01E01", s, 1)).toBe("Episode 1");
    expect(episodeTitle("The Nazi Party S01E02", s, 2)).toBe("The Nazi Party");
    expect(episodeTitle("", s, 4)).toBe("Episode 4");
    // A name the mark doesn't follow is a real title, and keeps every word.
    expect(episodeTitle("Lost in Space", { name: "Lost (2004)", title: "Lost" }, 1)).toBe("Lost in Space");
    expect(episodeTitle("Pilot", s, 1)).toBe("Pilot");
  });

  it("reads what the show's info says, as the list does", () => {
    expect(info.fields).toMatchObject({ year: 1984, synopsis: SHOW.plot, genres: ["Comedy", "War & Politics"], runtimeMin: 30 });
  });

  it("reads a season list the panel sent as an array, when its seasons start at 0", () => {
    const raw = { info: [], episodes: [[{ id: "5", episode_num: 1, title: "Special", container_extension: "mp4" }], [{ id: "6", episode_num: 1, container_extension: "mp4" }]] };
    expect(readSeriesInfo(showHd, raw).episodes.map((e) => [e.season, e.number, e.title])).toEqual([
      [0, 1, "Special"],
      [1, 1, "Episode 1"],
    ]);
  });

  it("files an episode under the key it is in, and under its own season when the key is not a number", () => {
    const raw = { episodes: { "2": [{ id: "1", episode_num: 4, container_extension: "mkv", season: 9 }], extras: [{ id: "2", episode_num: 1, container_extension: "mkv", season: 3 }] } };
    expect(readSeriesInfo(showHd, raw).episodes.map((e) => [e.season, e.number])).toEqual([[2, 4], [3, 1]]);
  });

  it("leaves out an episode with no usable id, number or extension, and a repeat", () => {
    const e = (over: Record<string, unknown>) => ({ id: "10", episode_num: 1, container_extension: "mkv", ...over });
    const raw = {
      episodes: {
        "1": [e({}), e({ id: "11" }), e({ id: "x1", episode_num: 2 }), e({ id: "12", episode_num: "two" }), e({ id: "13", episode_num: 3, container_extension: "" }), null, "x", e({ id: "14", episode_num: "4" })],
      },
    };
    expect(readSeriesInfo(showHd, raw).episodes.map((x) => [x.number, x.id])).toEqual([[1, "10"], [4, "14"]]);
  });

  it("is a show with no episodes for an answer that has none", () => {
    for (const raw of [[], {}, null, { episodes: [] }, { episodes: "x" }, { info: [], episodes: [] }])
      expect(readSeriesInfo(showHd, raw).episodes, JSON.stringify(raw)).toEqual([]);
  });
});

describe("a show's page across two copies", () => {
  const infos = [readSeriesInfo(showHd, SERIES_INFO), readSeriesInfo(show4k, SERIES_INFO_4K)];
  const page = showFromInfos(showTitle.item, infos);

  it("has the seasons of both copies, in order", () => {
    expect(page.seasons.map((s) => [s.id, s.number, s.name, s.episodes.length])).toEqual([
      ["s1", 1, "Season 1", 3],
      ["s2", 2, "Season 2", 2],
    ]);
  });

  it("merges an episode both copies hold into one tile, and gives it the episode key", () => {
    const ids = page.seasons.flatMap((s) => s.episodes.map((e) => e.id));
    expect(ids).toEqual([
      "xt:t:s:t4521:1:1",
      "xt:t:s:t4521:1:2",
      "xt:t:s:t4521:1:3",
      "xt:t:s:t4521:2:1",
      "xt:t:s:t4521:2:2",
    ]);
    expect(page.seasons[0].episodes[0]).toMatchObject({ number: 1, title: "Episode 1", airDate: "Sep 1, 1984" });
  });

  it("does not depend on the order the infos come in", () => {
    expect(showFromInfos(showTitle.item, [infos[1], infos[0]])).toEqual(page);
  });

  it("has an episode only one copy holds, whichever copy that is", () => {
    const only4k = readSeriesInfo(show4k, { episodes: { "1": [{ id: "9009", episode_num: 9, container_extension: "mkv" }] } });
    const merged = showFromInfos(showTitle.item, [infos[0], only4k]);
    expect(merged.seasons[0].episodes.map((e) => e.number)).toEqual([1, 2, 3, 9]);
  });

  it("puts Specials first", () => {
    const sp = readSeriesInfo(showHd, { episodes: { "1": [{ id: "1", episode_num: 1, container_extension: "mkv" }], "0": [{ id: "2", episode_num: 1, container_extension: "mkv" }] } });
    const p = showFromInfos(showTitle.item, [sp]);
    expect(p.seasons.map((s) => s.name)).toEqual(["Specials", "Season 1"]);
    expect(p.seasons[0].id).toBe("s0");
  });

  it("keeps the card's own fields and fills the ones it lacks", () => {
    expect(page).toMatchObject({ id: "xt:t:s:t4521", from: "xt", kind: "series", title: "'Allo 'Allo!", year: 1984, synopsis: SHOW.plot });
    const bare: VodItem = { ...showTitle.item, synopsis: undefined, backdrop: undefined, genres: [], cast: [], runtimeMin: undefined };
    const filled = showFromInfos(bare, infos);
    expect(filled).toMatchObject({
      synopsis: SHOW.plot,
      backdrop: SHOW.backdrop_path[0],
      genres: ["Comedy", "War & Politics"],
      cast: ["Gorden Kaye", "Carmen Silvera", "Vicki Michelle"],
      runtimeMin: 30,
    });
  });

  it("is the card with no seasons when no copy answered", () => {
    expect(showFromInfos(showTitle.item, [])).toEqual({ ...showTitle.item, seasons: [] });
  });

  it("does not change the card it was given", () => {
    const before = JSON.stringify(showTitle.item);
    showFromInfos(showTitle.item, infos);
    expect(JSON.stringify(showTitle.item)).toBe(before);
  });
});
