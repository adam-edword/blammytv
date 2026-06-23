import { describe, it, expect } from "vitest";
import {
  mapStream,
  mapStreams,
  metaToVod,
  metaPreviewToVod,
  mapSeasons,
} from "./mapper.js";
import type { MetaDetail, Stream, Video } from "./types.js";

// Real responses from a live AIOStreams instance (recon for v0.2.0). Stream
// `url`s are redacted — the debrid token is a secret and never belongs in the
// repo; the mapper only passes the url through, so a placeholder exercises it.

describe("mapStream", () => {
  // Interstellar 4K REMUX (FraMeSToR) — no languages line.
  const remux: Stream = {
    name: "4K ⚡",
    description: "𖥂 Interstellar (2014)\n◧ 55.7 mb/s \n★★★★☆",
    url: "https://addon.debridio.com/play/movie/torbox/REDACTED/remux.mkv",
    behaviorHints: {
      bingeGroup: "AIOStreams|2160p|BluRay REMUX|FraMeSToR",
      videoSize: 70587787510,
      filename: "Interstellar.2014.UHD.BluRay.2160p…REMUX-FraMeSToR",
    },
  };

  it("maps quality, cached and the glyph meta lines", () => {
    expect(mapStream(remux)).toMatchObject({
      quality: "2160p",
      cached: true,
      lines: [
        "☁︎ BluRay REMUX · FraMeSToR",
        "◧ 55.7 Mb/s · 70.6 GB",
        "★★★★☆",
      ],
      streamUrl: "https://addon.debridio.com/play/movie/torbox/REDACTED/remux.mkv",
    });
  });

  it("keeps a languages line when present", () => {
    const multi: Stream = {
      name: "4K ⚡",
      description:
        "𖥂 Interstellar (2014)\n🗣 English · Japanese · Russian\n◧ 66.3 mb/s \n★★★⯪☆",
      url: "https://addon.debridio.com/play/movie/torbox/REDACTED/sgf.mkv",
      behaviorHints: {
        bingeGroup: "AIOStreams|2160p|BluRay REMUX|SGF",
        videoSize: 83988085473,
      },
    };
    expect(mapStream(multi).lines).toEqual([
      "☁︎ BluRay REMUX · SGF",
      "🗣 English · Japanese · Russian",
      "◧ 66.3 Mb/s · 84.0 GB",
      "★★★⯪☆",
    ]);
  });

  it("reads 1080p out of a no-space name/bingeGroup", () => {
    expect(mapStream({ name: "1080p⚡", url: "https://x/y.mkv" }).quality).toBe(
      "1080p",
    );
  });

  it("drops sources without a playable http url", () => {
    expect(mapStreams([{ name: "4K", url: "magnet:?xt=urn:btih:abc" }])).toEqual(
      [],
    );
  });
});

describe("metaToVod (movie)", () => {
  const interstellar: MetaDetail = {
    id: "tt0816692",
    type: "movie",
    name: "Interstellar",
    poster: "https://aiostreams.blammy.org/api/v1/posters/rpdb?id=tt0816692",
    genres: ["Adventure", "Drama", "Science Fiction"],
    imdbRating: "8.7",
    releaseInfo: "2014",
    description: "The adventures of a group of explorers…",
    background: "https://image.tmdb.org/t/p/original/2ssWTSVklAEc98frZUQhgtGHx7s.jpg",
    runtime: "2h49min",
    year: "2014",
    cast: [
      { name: "Matthew McConaughey", character: "Cooper" },
      { name: "Anne Hathaway", character: "Brand" },
    ],
  };

  it("maps the detail fields and resolves runtime to minutes", () => {
    expect(metaToVod(interstellar)).toMatchObject({
      id: "tt0816692",
      title: "Interstellar",
      year: 2014,
      kind: "movie",
      rating: 8.7,
      runtimeMin: 169,
      genres: ["Adventure", "Drama", "Science Fiction"],
      cast: ["Matthew McConaughey", "Anne Hathaway"],
      sources: [],
      seasons: [],
    });
    expect(metaToVod(interstellar).backdrop).toContain("image.tmdb.org");
  });
});

describe("metaToVod (series)", () => {
  // A slice covering: a season-0 special (kept), an unreleased special
  // (available:false → dropped), and seasons 1–2.
  const videos: Video[] = [
    { id: "tt0903747:0:1", title: "Good Cop / Bad Cop", season: 0, episode: 1, released: "2009-02-18T02:00:00.000Z", available: true, runtime: "3min", thumbnail: "https://artworks.thetvdb.com/x.jpg" },
    { id: "tt0903747:0:20", title: "Live Saul Cam", season: 0, episode: 20, released: null, available: false },
    { id: "tt0903747:1:2", title: "Cat's in the Bag...", season: 1, episode: 2, released: "2008-01-28T02:00:00.000Z", available: true },
    { id: "tt0903747:1:1", title: "Pilot", season: 1, episode: 1, released: "2008-01-21T02:00:00.000Z", available: true },
    { id: "tt0903747:2:1", title: "Seven Thirty-Seven", season: 2, episode: 1, released: "2009-03-09T01:00:00.000Z", available: true },
  ];
  const breakingBad: MetaDetail = {
    id: "tt0903747",
    type: "series",
    name: "Breaking Bad",
    imdbRating: "9.5",
    releaseInfo: "2008-2013",
    runtime: "48min",
    genres: ["Drama", "Crime"],
    videos,
  };

  it("groups into ordered seasons, drops unreleased, orders episodes", () => {
    const vod = metaToVod(breakingBad);
    expect(vod.kind).toBe("series");
    expect(vod.year).toBe(2008);
    expect(vod.runtimeMin).toBe(48);
    expect(vod.seasons.map((s) => s.name)).toEqual([
      "Specials",
      "Season 1",
      "Season 2",
    ]);
    // Specials kept just the released one.
    expect(vod.seasons[0].episodes).toHaveLength(1);
    // Episodes sorted within the season; ids preserved for on-demand resolution.
    expect(vod.seasons[1].episodes.map((e) => e.id)).toEqual([
      "tt0903747:1:1",
      "tt0903747:1:2",
    ]);
    expect(vod.seasons[1].episodes[0]).toMatchObject({
      number: 1,
      title: "Pilot",
      airDate: "Jan 21, 2008",
    });
  });

  it("mapSeasons skips a series with no released episodes", () => {
    expect(
      mapSeasons([{ id: "x:1:1", season: 1, episode: 1, available: false }]),
    ).toEqual([]);
  });
});

describe("metaPreviewToVod", () => {
  it("maps a lightweight browse-grid entry", () => {
    expect(
      metaPreviewToVod({
        id: "tt0111161",
        type: "movie",
        name: "The Shawshank Redemption",
        poster: "https://img/poster.jpg",
        releaseInfo: "1994",
      }),
    ).toMatchObject({
      id: "tt0111161",
      title: "The Shawshank Redemption",
      kind: "movie",
      year: 1994,
      poster: "https://img/poster.jpg",
      seasons: [],
      sources: [],
    });
  });
});
