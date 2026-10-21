import { describe, expect, it } from "vitest";
import { mapStreams } from "../stream/mapper";
import { buildLibrary } from "./library";
import { readMovies, readShows } from "./read";
import { readSeriesInfo } from "./series";
import { episodeStreams, movieStreams, playUrl, qualityLabel, type XtCreds } from "./sources";
import { CREDS, MOVIE_4K, MOVIE_FOLDERS, MOVIE_HD, SERIES_INFO, SERIES_INFO_4K, SERVER, SHOW, SHOW_4K, SHOW_FOLDERS } from "./fixture";

/** An account whose name and password both need encoding in an address. */
const AWKWARD: XtCreds = { server: ` ${SERVER}/// `, username: "ad am", password: "p@ss/w:rd?#%" };

describe("a file's address", () => {
  it("is the server, the kind, the account, the id and the extension", () => {
    expect(playUrl(CREDS, "movie", "52114", "mkv")).toBe(`${SERVER}/movie/adam/pw/52114.mkv`);
    expect(playUrl(CREDS, "series", "186", "mp4")).toBe(`${SERVER}/series/adam/pw/186.mp4`);
  });

  it("trims the server and drops its trailing slashes, and encodes the account as Live's address does", () => {
    expect(playUrl(AWKWARD, "movie", "52114", "mkv")).toBe(
      `${SERVER}/movie/ad%20am/p%40ss%2Fw%3Ard%3F%23%25/52114.mkv`,
    );
    expect(playUrl({ ...CREDS, server: `${SERVER}/` }, "movie", "1", "mkv")).toBe(`${SERVER}/movie/adam/pw/1.mkv`);
  });

  it("is null for an id or an extension that could change the address", () => {
    expect(playUrl(CREDS, "movie", "../1", "mkv")).toBeNull();
    expect(playUrl(CREDS, "movie", "0", "mkv")).toBeNull();
    expect(playUrl(CREDS, "movie", "1", "mkv/../x")).toBeNull();
    expect(playUrl(CREDS, "movie", "1", "")).toBeNull();
  });
});

describe("a movie's sources", () => {
  const copies = readMovies([MOVIE_HD, MOVIE_4K]);
  const streams = movieStreams(CREDS, copies);

  it("are one per copy, the 4K one first, whichever order the copies came in", () => {
    expect(streams.map((s) => s.url)).toEqual([
      `${SERVER}/movie/adam/pw/52114.mkv`,
      `${SERVER}/movie/adam/pw/52390.mp4`,
    ]);
    expect(movieStreams(CREDS, [...copies].reverse()).map((s) => s.url)).toEqual(streams.map((s) => s.url));
  });

  it("show what the source list shows: 2160p for the 4K copy, HD for the other", () => {
    const sources = mapStreams(streams);
    expect(sources.map((s) => s.quality)).toEqual(["2160p", "HD"]);
    expect(sources[0].lines).toEqual(["4K The Fantastic 4: First Steps (2025)", "MKV"]);
    expect(sources[1].lines).toEqual(["The Fantastic 4: First Steps (2025)", "MP4"]);
  });

  it("are the provider's own file and there already, so auto-play may take the first", () => {
    const sources = mapStreams(streams);
    expect(sources.map((s) => [s.cached, s.cache])).toEqual([[true, "cached"], [true, "cached"]]);
  });

  it("carry a binge group by quality and a file name that tells the copies apart", () => {
    const sources = mapStreams(streams);
    expect(sources.map((s) => s.bingeGroup)).toEqual(["xtream|2160p", "xtream|HD"]);
    expect(sources.map((s) => s.fileName)).toEqual([
      "4K The Fantastic 4: First Steps (2025).mkv",
      "The Fantastic 4: First Steps (2025).mp4",
    ]);
  });

  it("show every tag as what it says, and an untagged name as HD, not the mapper's SD", () => {
    const q = (name: string) => mapStreams(movieStreams(CREDS, readMovies([{ ...MOVIE_4K, name }])))[0].quality;
    expect(q("4K Movie")).toBe("2160p");
    expect(q("UHD Movie")).toBe("2160p");
    expect(q("FHD Movie")).toBe("1080p");
    expect(q("1080p Movie")).toBe("1080p");
    expect(q("[HD] Movie")).toBe("HD");
    expect(q("HDR | Movie")).toBe("HDR");
    expect(q("SD | Movie")).toBe("SD");
    expect(q("Movie")).toBe("HD");
    expect(qualityLabel(null)).toBe("HD");
  });

  it("put the account in the address and nowhere else", () => {
    const text = JSON.stringify(movieStreams(AWKWARD, copies));
    expect(text.match(/p%40ss%2Fw%3Ard%3F%23%25/g)).toHaveLength(2); // once in each address
    expect(text).not.toContain("p@ss");
    for (const s of mapStreams(movieStreams(AWKWARD, copies))) {
      expect(s.lines.join("\n")).not.toMatch(/p%40ss|ad%20am|ad am/);
      expect(s.fileName).not.toMatch(/p%40ss|ad%20am/);
    }
  });

  it("are none for no copies", () => {
    expect(movieStreams(CREDS, [])).toEqual([]);
  });

  it("leave out a copy whose address cannot be built", () => {
    const bad = [{ ...copies[0], ext: "" }, copies[1]];
    expect(movieStreams(CREDS, bad)).toHaveLength(1);
  });
});

describe("an episode's sources", () => {
  const lib = buildLibrary(
    "t",
    { movies: readMovies([MOVIE_4K, MOVIE_HD]), shows: readShows([SHOW, SHOW_4K]), movieFolders: MOVIE_FOLDERS, showFolders: SHOW_FOLDERS },
    true,
  );
  const title = lib.titles.get("xt:t:s:t4521")!;
  if (title.kind !== "series") throw new Error("the fixture's show is not a show");
  const [show4k, showHd] = title.copies;
  const infos = [readSeriesInfo(showHd, SERIES_INFO), readSeriesInfo(show4k, SERIES_INFO_4K)];

  it("are one per copy that holds that season and number, by the episode's own id, the 4K one first", () => {
    const s = episodeStreams(CREDS, infos, 1, 2);
    expect(s.map((x) => x.url)).toEqual([`${SERVER}/series/adam/pw/9002.mkv`, `${SERVER}/series/adam/pw/187.mkv`]);
    const sources = mapStreams(s);
    expect(sources.map((x) => x.quality)).toEqual(["2160p", "HD"]);
    expect(sources[0].lines).toEqual(["4K 'Allo 'Allo! (1984)", "Episode 2", "MKV"]);
    expect(sources.map((x) => x.bingeGroup)).toEqual(["xtream|2160p", "xtream|HD"]);
    expect(sources.map((x) => x.cached)).toEqual([true, true]);
  });

  it("are from the one copy that has the episode, when only one does", () => {
    expect(episodeStreams(CREDS, infos, 2, 1).map((x) => x.url)).toEqual([`${SERVER}/series/adam/pw/201.mkv`]);
  });

  it("are none for an episode no copy holds", () => {
    expect(episodeStreams(CREDS, infos, 3, 1)).toEqual([]);
    expect(episodeStreams(CREDS, infos, 1, 99)).toEqual([]);
    expect(episodeStreams(CREDS, [], 1, 1)).toEqual([]);
  });

  it("name each copy's file apart, for Continue Watching to find it again", () => {
    const names = mapStreams(episodeStreams(CREDS, infos, 1, 1)).map((x) => x.fileName);
    expect(names).toEqual(["4K 'Allo 'Allo! (1984) - Episode 1.mkv", "'Allo 'Allo! (1984) - Episode 1.mkv"]);
  });

  it("encode the account the way a movie's address does", () => {
    expect(episodeStreams(AWKWARD, infos, 2, 2)[0].url).toBe(`${SERVER}/series/ad%20am/p%40ss%2Fw%3Ard%3F%23%25/202.mkv`);
  });

  it("do not depend on the order the infos come in", () => {
    expect(episodeStreams(CREDS, [infos[1], infos[0]], 1, 1)).toEqual(episodeStreams(CREDS, infos, 1, 1));
  });
});
