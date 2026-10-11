import { describe, expect, it } from "vitest";
import {
  groupSources,
  isOut,
  mapSeasons,
  mapStreams,
  metaPreviewToVod,
  metaToVod,
  nextEpisode,
  nextUpEpisode,
  noticesOf,
  pickCachedIndex,
  pickResumeIndex,
} from "./mapper";

describe("mapStreams", () => {
  it("filters to http streams, preserves addon order, parses quality/cached/lines", () => {
    const out = mapStreams([
      {
        name: "⚡ 4K | Debrid",
        description: "Fake Movie 4K\n8.2GB ⚡",
        url: "http://host/video/a-4k.mp4",
        behaviorHints: { bingeGroup: "fake|2160p|x265" },
      },
      {
        name: "1080p | Debrid",
        description: "Fake 1080p\n2.1GB",
        url: "http://host/video/a-1080.mp4",
        behaviorHints: { bingeGroup: "fake|1080p" },
      },
      // magnet-only entry: no url → unplayable in mpv → dropped
      { name: "Torrent", description: "seeders: 12" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      quality: "2160p",
      cached: true,
      lines: ["Fake Movie 4K", "8.2GB ⚡"],
      streamUrl: "http://host/video/a-4k.mp4",
      bingeGroup: "fake|2160p|x265", // carried for episode-roll stickiness
    });
    expect(out[1]).toMatchObject({ quality: "1080p", cached: false });
    // Order is the addon's ranking — never re-sorted.
    expect(out.map((s) => s.streamUrl)).toEqual([
      "http://host/video/a-4k.mp4",
      "http://host/video/a-1080.mp4",
    ]);
  });

  it("carries the file name the addon sends, and none when it sends none", () => {
    const out = mapStreams([
      { name: "a", url: "http://h/a.mkv", behaviorHints: { filename: "Show.S01E01.1080p.mkv" } },
      { name: "b", url: "http://h/b.mkv", behaviorHints: { bingeGroup: "g|1080p" } },
      { name: "c", url: "http://h/c.mkv", behaviorHints: { filename: "  " } },
      { name: "d", url: "http://h/d.mkv" },
    ]);
    expect(out[0].fileName).toBe("Show.S01E01.1080p.mkv");
    // Absent, not empty: a resume must not match "" against "".
    expect(out.slice(1).map((s) => "fileName" in s)).toEqual([false, false, false]);
  });

  it("falls back to name parsing when bingeGroup has no resolution", () => {
    const out = mapStreams([
      { name: "Some 720p rip", url: "http://h/x.mp4" },
      { name: "UHD remux", url: "http://h/y.mp4" },
      { name: "", url: "http://h/z.mp4" },
    ]);
    expect(out.map((s) => s.quality)).toEqual(["720p", "2160p", "SD"]);
  });

  it("prefers structured streamData.service.cached over formatter text", () => {
    const out = mapStreams([
      // Custom formatter without ⚡, but structured says cached.
      {
        name: "RD 1080p",
        url: "http://h/a.mp4",
        streamData: { type: "debrid", service: { id: "realdebrid", cached: true } },
      },
      // ⚡ present but structured says NOT cached — structure wins.
      {
        name: "⚡ decorative",
        url: "http://h/b.mp4",
        streamData: { type: "debrid", service: { id: "realdebrid", cached: false } },
      },
      // No service info at all → falls back to text sniffing.
      { name: "plain", url: "http://h/c.mp4", streamData: { type: "http" } },
    ]);
    expect(out.map((s) => s.cached)).toEqual([true, false, false]);
  });

  it("recognizes Torrentio-style [XX+] cached markers", () => {
    const out = mapStreams([
      { name: "[RD+] Movie 1080p", url: "http://h/a.mp4" },
      { name: "[TB+] Movie 4K", url: "http://h/b.mp4" },
      { name: "[RD download] Movie", url: "http://h/c.mp4" },
    ]);
    expect(out.map((s) => s.cached)).toEqual([true, true, false]);
  });
});

describe("the three-way cache status (plan 019, Sources)", () => {
  const status = (streams: Parameters<typeof mapStreams>[0]) =>
    mapStreams(streams).map((s) => s.cache);

  it("takes AIOStreams' service.cached either way, over any text", () => {
    expect(
      status([
        { name: "RD 1080p", url: "http://h/a.mp4", streamData: { service: { id: "realdebrid", cached: true } } },
        { name: "⚡ decorative", url: "http://h/b.mp4", streamData: { service: { id: "torbox", cached: false } } },
        // Usenet goes through a service too; the flag means the same.
        { name: "NZB 4K ⏳", url: "http://h/c.mp4", streamData: { type: "usenet", service: { id: "torbox", cached: true } } },
      ]),
    ).toEqual(["cached", "uncached", "cached"]);
  });

  it("reads cached from the ⚡ and the [RD+] family, as auto-play does", () => {
    const out = mapStreams([
      { name: "⚡ 4K", url: "http://h/a.mp4" },
      { name: "4K", description: "Movie\n8.2GB ⚡", url: "http://h/b.mp4" },
      { name: "[AD+] Movie 1080p", url: "http://h/c.mp4" },
    ]);
    expect(out.map((s) => s.cache)).toEqual(["cached", "cached", "cached"]);
    // The boolean and the status never disagree.
    expect(out.every((s) => s.cached)).toBe(true);
  });

  it("reads not cached from AIOStreams' ⏳ and Torrentio's [RD download]", () => {
    const out = mapStreams([
      // AIOStreams' GDrive formatter: "[RD⏳]" after the service.
      { name: "[RD⏳] AIOStreams 1080p", url: "http://h/a.mp4" },
      { name: "1080p", description: "Movie\n[TB⏳] 2.1GB", url: "http://h/b.mp4" },
      { name: "[RD download] Torrentio\n1080p", url: "http://h/c.mp4" },
    ]);
    expect(out.map((s) => s.cache)).toEqual(["uncached", "uncached", "uncached"]);
    expect(out.some((s) => s.cached)).toBe(false);
  });

  it("says unknown, not 'not cached', when nothing says either", () => {
    expect(
      status([
        // A direct link: no service to be cached on.
        { name: "Direct 1080p", url: "http://h/a.mp4", streamData: { type: "http" } },
        // An addon that marks nothing.
        { name: "Some Addon 720p", description: "Movie.720p.mkv", url: "http://h/b.mp4" },
      ]),
    ).toEqual(["unknown", "unknown"]);
  });

  it("keeps every line, from `title` when an older addon sends it there", () => {
    const [s] = mapStreams([
      { name: "Torrentio\n4k", title: "Movie.2160p.mkv\n👤 12 💾 5 GB\n🇬🇧 / 🇫🇷", url: "http://h/a.mp4" },
    ]);
    expect(s.lines).toEqual(["Movie.2160p.mkv", "👤 12 💾 5 GB", "🇬🇧 / 🇫🇷"]);
  });
});

describe("groupSources", () => {
  const at = (id: string, cache: "cached" | "uncached" | "unknown") => ({
    id,
    quality: "1080p",
    cached: cache === "cached",
    cache,
    lines: [],
    streamUrl: `http://h/${id}`,
  });

  it("puts cached first, then the unknowns, then not cached, each labelled", () => {
    const groups = groupSources([at("a", "uncached"), at("b", "unknown"), at("c", "cached")]);
    expect(groups.map((g) => [g.label, g.sources.map((s) => s.id)])).toEqual([
      ["Cached", ["c"]],
      ["Other sources", ["b"]],
      ["Not cached", ["a"]],
    ]);
  });

  it("keeps the addon's order inside each group", () => {
    const groups = groupSources([
      at("u1", "uncached"),
      at("c1", "cached"),
      at("u2", "uncached"),
      at("c2", "cached"),
      at("c3", "cached"),
    ]);
    expect(groups.map((g) => g.sources.map((s) => s.id))).toEqual([
      ["c1", "c2", "c3"],
      ["u1", "u2"],
    ]);
  });

  it("drops a group with nothing in it", () => {
    expect(groupSources([at("a", "cached"), at("b", "uncached")]).map((g) => g.label)).toEqual([
      "Cached",
      "Not cached",
    ]);
    expect(groupSources([at("a", "cached"), at("b", "cached")]).map((g) => g.label)).toEqual(["Cached"]);
  });

  it("draws no labels at all when no source's status is known", () => {
    const groups = groupSources([at("a", "unknown"), at("b", "unknown")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].sources.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("is empty for an empty list", () => {
    expect(groupSources([])).toEqual([]);
  });
});

describe("pickCachedIndex", () => {
  const src = (id: string, cached: boolean, group?: string) => ({
    id,
    quality: "1080p",
    cached,
    cache: cached ? ("cached" as const) : ("unknown" as const),
    lines: [],
    streamUrl: `http://h/${id}`,
    ...(group ? { bingeGroup: group } : {}),
  });

  it("prefers a cached source from the same bingeGroup", () => {
    const list = [src("a", true, "g1"), src("b", true, "g2")];
    expect(pickCachedIndex(list, "g2")).toBe(1);
    expect(pickCachedIndex(list, "g1")).toBe(0);
  });

  it("falls back to the first cached when the group has no cached match", () => {
    // g2 exists but only UNCACHED — stickiness never overrides the
    // cached-only rule.
    const list = [src("a", false, "g2"), src("b", true, "g1")];
    expect(pickCachedIndex(list, "g2")).toBe(1);
    // No group preference at all → plain first-cached.
    expect(pickCachedIndex(list)).toBe(1);
  });

  it("returns -1 when nothing is cached", () => {
    expect(pickCachedIndex([src("a", false, "g1")], "g1")).toBe(-1);
    expect(pickCachedIndex([])).toBe(-1);
  });
});

describe("noticesOf", () => {
  const said = (type: string, name?: string, description?: string, url?: string) => ({
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(url ? { url } : {}),
    streamData: { type },
  });

  it("keeps what AIOStreams said with an error, a statistic or an info line", () => {
    expect(
      noticesOf([
        said("error", "Torbox", "Rate limit exceeded"),
        said("statistic", "Statistics", "Fetched 80 streams in 1.2s"),
        said("info", "Heads up", "Your debrid key expires soon"),
      ]),
    ).toEqual(["Torbox: Rate limit exceeded", "Statistics: Fetched 80 streams in 1.2s", "Heads up: Your debrid key expires soon"]);
  });

  it("trims, drops the empty part, and says one part alone", () => {
    expect(noticesOf([said("error", "  [❌] AIOStreams  ", "\n No addons answered \n")])).toEqual([
      "[❌] AIOStreams: No addons answered",
    ]);
    expect(noticesOf([said("error", "Only a name")])).toEqual(["Only a name"]);
    expect(noticesOf([said("statistic", undefined, "Only a description")])).toEqual(["Only a description"]);
    expect(noticesOf([said("error", "  ", "")])).toEqual([]);
  });

  it("cuts a URL in a notice to its origin: an addon's error can quote the address it failed on", () => {
    expect(
      noticesOf([said("error", "Torrentio", "Failed to fetch https://torrentio.example/CONFIG-WITH-KEY/manifest.json (timed out)")]),
    ).toEqual(["Torrentio: Failed to fetch https://torrentio.example/… (timed out)"]);
  });

  it("says the same thing once", () => {
    expect(noticesOf([said("error", "Torbox", "Down"), said("error", "Torbox", "Down"), said("error", "Debrid-Link", "Down")])).toEqual([
      "Torbox: Down",
      "Debrid-Link: Down",
    ]);
  });

  it("keeps three at most, the first three", () => {
    const four = ["a", "b", "c", "d"].map((n) => said("error", n, "x"));
    expect(noticesOf(four)).toEqual(["a: x", "b: x", "c: x"]);
  });

  it("takes nothing from a stream that plays", () => {
    // Not a notice: it has a URL, and is a source. (mapStreams keeps it.)
    expect(noticesOf([said("error", "Odd", "an error that plays", "https://cdn.example.com/x.mp4")])).toEqual([]);
    expect(noticesOf([said("info", "Odd", "an info that plays", "http://cdn.example.com/x.mp4")])).toEqual([]);
  });

  it("takes nothing from a stream with no URL that is not a message: a magnet-only entry, a link", () => {
    expect(
      noticesOf([
        { name: "Torrent", description: "magnet-only entry" },
        said("p2p", "Torrentio", "1080p 2.1GB"),
        said("external", "More at example.com", "Open in your browser"),
        { name: "no streamData at all", description: "from an addon that sends none" },
      ]),
    ).toEqual([]);
  });

  it("keeps the notices beside sources and leaves the sources alone", () => {
    const streams = [
      { name: "1080p", url: "https://cdn.example.com/a.mkv" },
      said("statistic", "Statistics", "Fetched 80 streams"),
    ];
    expect(mapStreams(streams).map((x) => x.streamUrl)).toEqual(["https://cdn.example.com/a.mkv"]);
    expect(noticesOf(streams)).toEqual(["Statistics: Fetched 80 streams"]);
  });
});

describe("pickResumeIndex", () => {
  const src = (id: string, cached: boolean, over: { file?: string; group?: string } = {}) => ({
    id,
    quality: "1080p",
    cached,
    cache: cached ? ("cached" as const) : ("uncached" as const),
    lines: [],
    streamUrl: `http://h/${id}`,
    ...(over.group ? { bingeGroup: over.group } : {}),
    ...(over.file ? { fileName: over.file } : {}),
  });

  it("goes back to the same file, not the first cached", () => {
    const list = [src("a", true, { file: "A.mkv" }), src("b", true, { file: "B.mkv" })];
    expect(pickResumeIndex(list, { fileName: "B.mkv" })).toBe(1);
  });

  it("takes the file over the group", () => {
    const list = [
      src("a", true, { file: "A.mkv", group: "g1" }),
      src("b", true, { file: "B.mkv", group: "g2" }),
    ];
    expect(pickResumeIndex(list, { fileName: "B.mkv", bingeGroup: "g1" })).toBe(1);
  });

  it("falls back to the same binge group when the file is not in the list", () => {
    const list = [src("a", true, { file: "A.mkv", group: "g1" }), src("b", true, { file: "B.mkv", group: "g2" })];
    expect(pickResumeIndex(list, { fileName: "gone.mkv", bingeGroup: "g2" })).toBe(1);
    // No file remembered at all: the group, as an episode roll does.
    expect(pickResumeIndex(list, { bingeGroup: "g2" })).toBe(1);
  });

  it("falls back to the first cached when neither is there, as it always did", () => {
    const list = [src("a", false, { file: "A.mkv" }), src("b", true), src("c", true)];
    expect(pickResumeIndex(list, { fileName: "gone.mkv", bingeGroup: "gone" })).toBe(1);
    expect(pickResumeIndex(list, {})).toBe(1);
  });

  it("never picks an uncached source, even the one with the same file name", () => {
    // The rate-limited account (v0.3.5): the file the entry was on is no
    // longer cached, so resume takes a cached one instead of opening it.
    const list = [src("a", false, { file: "B.mkv" }), src("b", true, { file: "C.mkv" })];
    expect(pickResumeIndex(list, { fileName: "B.mkv" })).toBe(1);
    // And a same-group uncached one, through the group step.
    const grouped = [src("a", false, { group: "g1" }), src("b", true, { group: "g2" })];
    expect(pickResumeIndex(grouped, { bingeGroup: "g1" })).toBe(1);
  });

  it("says nothing is cached when only the file's own source is uncached", () => {
    expect(pickResumeIndex([src("a", false, { file: "B.mkv" })], { fileName: "B.mkv" })).toBe(-1);
    expect(pickResumeIndex([], { fileName: "B.mkv" })).toBe(-1);
  });
});

describe("mapSeasons", () => {
  it("groups by season, sorts, drops unavailable, Specials first", () => {
    const seasons = mapSeasons([
      { id: "tt1:2:1", season: 2, episode: 1, name: "S2E1" },
      { id: "tt1:1:2", season: 1, episode: 2, name: "S1E2" },
      { id: "tt1:1:1", season: 1, episode: 1, name: "S1E1", released: "2024-01-01T00:00:00Z" },
      { id: "tt1:0:1", season: 0, episode: 1, name: "Special" },
      { id: "tt1:2:2", season: 2, episode: 2, name: "gone", available: false },
    ]);
    expect(seasons.map((s) => s.name)).toEqual([
      "Specials",
      "Season 1",
      "Season 2",
    ]);
    expect(seasons[1].episodes.map((e) => e.number)).toEqual([1, 2]);
    expect(seasons[2].episodes).toHaveLength(1); // unavailable dropped
    expect(seasons[1].episodes[0].airDate).toBe("Jan 1, 2024");
  });

  it("gives the air date the addon means, wherever it is read", () => {
    // Cinemeta's own encoding: the Breaking Bad pilot, sent as 05:00 UTC.
    // As an instant that was the evening of the 20th west of UTC-5.
    const [season] = mapSeasons([
      { id: "tt0903747:1:1", season: 1, episode: 1, name: "Pilot", released: "2008-01-21T05:00:00.000Z" },
    ]);
    expect(season.episodes[0].airDate).toBe("Jan 21, 2008");
  });
});

describe("an episode that has not aired", () => {
  // A Sunday afternoon: the 11th is today, in whatever zone this runs.
  const NOW = new Date(2026, 9, 11, 15, 0).getTime();
  const seasons = mapSeasons([
    { id: "tt1:1:1", season: 1, episode: 1, name: "a", released: "2026-10-04T00:00:00Z" },
    { id: "tt1:1:2", season: 1, episode: 2, name: "b", released: "2026-10-11T00:00:00Z" },
    { id: "tt1:1:3", season: 1, episode: 3, name: "c", released: "2026-10-14T00:00:00Z" },
    { id: "tt1:1:4", season: 1, episode: 4, name: "d", released: "2026-10-21T00:00:00Z" },
    { id: "tt1:2:1", season: 2, episode: 1, name: "e", released: "2027-02-01T05:00:00.000Z" },
  ]);
  const ep = (id: string) => seasons.flatMap((s) => s.episodes).find((e) => e.id === id)!;

  it("carries the day it airs, as that day's midnight where the viewer is", () => {
    expect(ep("tt1:1:3").airsAt).toBe(new Date(2026, 9, 14).getTime());
    // Cinemeta's 05:00Z is the 1st of February everywhere, not the evening of the 31st.
    expect(ep("tt1:2:1").airsAt).toBe(new Date(2027, 1, 1).getTime());
  });

  it("has no day when the meta has no released, or one that is not a date", () => {
    const [s] = mapSeasons([
      { id: "x:1:1", season: 1, episode: 1, name: "a" },
      { id: "x:1:2", season: 1, episode: 2, name: "b", released: null },
      { id: "x:1:3", season: 1, episode: 3, name: "c", released: "soon" },
    ]);
    expect(s.episodes.map((e) => "airsAt" in e)).toEqual([false, false, false]);
  });

  it("is out on its day and after, not before it", () => {
    expect(isOut(ep("tt1:1:1"), NOW)).toBe(true);
    // Today: the day, not the hour (a 00:00Z release is yesterday evening in Chicago).
    expect(isOut(ep("tt1:1:2"), NOW)).toBe(true);
    expect(isOut(ep("tt1:1:2"), new Date(2026, 9, 11, 0, 0).getTime())).toBe(true);
    expect(isOut(ep("tt1:1:3"), NOW)).toBe(false);
    expect(isOut(ep("tt1:1:3"), new Date(2026, 9, 13, 23, 59).getTime())).toBe(false);
    expect(isOut(ep("tt1:1:3"), new Date(2026, 9, 14, 0, 0).getTime())).toBe(true);
  });

  it("with no day is out, as every episode was before there was one", () => {
    expect(isOut({}, NOW)).toBe(true);
    expect(isOut({ airsAt: undefined }, NOW)).toBe(true);
  });

  it("nextEpisode never returns one: the end of the last aired episode is the end of the run", () => {
    expect(nextEpisode(seasons, "tt1:1:1", NOW)?.episode.id).toBe("tt1:1:2");
    expect(nextEpisode(seasons, "tt1:1:2", NOW)).toBeNull();
    // Nor one further on, in the next season.
    expect(nextEpisode(seasons, "tt1:1:4", NOW)).toBeNull();
  });

  it("nextEpisode offers it once its day comes", () => {
    const day = new Date(2026, 9, 14, 9, 0).getTime();
    expect(nextEpisode(seasons, "tt1:1:2", day)?.episode.id).toBe("tt1:1:3");
  });

  it("nextEpisode rolls into a new season only when that season's first has aired", () => {
    const later = new Date(2027, 1, 1, 10, 0).getTime();
    expect(nextEpisode(seasons, "tt1:1:4", later)?.episode.id).toBe("tt1:2:1");
  });

  it("nextUpEpisode does not land you on one", () => {
    const watched = new Set(["tt1:1:1", "tt1:1:2"]);
    expect(nextUpEpisode(seasons, watched, undefined, NOW)).toBeNull();
    // Finished the last aired: no next to offer either.
    expect(nextUpEpisode(seasons, watched, { episodeId: "tt1:1:2", finished: true }, NOW)).toBeNull();
    // An unwatched one that has aired is still the answer.
    expect(nextUpEpisode(seasons, new Set(["tt1:1:1"]), undefined, NOW)).toBe("tt1:1:2");
  });
});

describe("metaToVod", () => {
  it("parses runtime/year/kind and keeps only http artwork", () => {
    const v = metaToVod({
      id: "tt5",
      type: "anime.series",
      name: "Show",
      runtime: "2h49min",
      releaseInfo: "2019-2024",
      poster: "not a url",
      background: "http://h/bg.png",
      cast: [{ name: "A" }, { name: "B" }],
      videos: [],
    });
    expect(v.kind).toBe("series"); // "anime.series" counts as series
    expect(v.runtimeMin).toBe(169);
    expect(v.year).toBe(2019);
    expect(v.poster).toBeUndefined();
    expect(v.backdrop).toBe("http://h/bg.png");
    expect(v.cast).toEqual(["A", "B"]);
  });

  it("falls back to Cast links when meta.cast is absent", () => {
    const v = metaToVod({
      id: "tt9",
      type: "movie",
      name: "Linked",
      links: [
        { category: "Cast", name: "Keanu Reeves" },
        { category: "Genres", name: "Comedy" },
        { category: "cast", name: "Cameron Diaz" },
        { category: "Cast" }, // nameless → dropped
      ],
      videos: [],
    });
    expect(v.cast).toEqual(["Keanu Reeves", "Cameron Diaz"]);
  });
});

describe("metaPreviewToVod", () => {
  it("keeps runtime when the catalog preview provides it", () => {
    const v = metaPreviewToVod({
      id: "tt6",
      type: "movie",
      name: "Film",
      runtime: "129 min",
      releaseInfo: 2021,
    });
    expect(v.runtimeMin).toBe(129);
    expect(v.year).toBe(2021);
    // And absent runtime stays absent — no fake zeroes on the meta line.
    expect(
      metaPreviewToVod({ id: "tt7", type: "movie", name: "X" }).runtimeMin,
    ).toBeUndefined();
  });

  it("keeps the backdrop and the logo when the catalog sends them", () => {
    const v = metaPreviewToVod({
      id: "tt8",
      type: "movie",
      name: "Film",
      background: "https://img/bg.jpg",
      logo: "https://img/logo.png",
    });
    expect(v.backdrop).toBe("https://img/bg.jpg");
    expect(v.logo).toBe("https://img/logo.png");
    const bare = metaPreviewToVod({ id: "tt9", type: "movie", name: "X" });
    expect(bare.backdrop).toBeUndefined();
    expect(bare.logo).toBeUndefined();
  });
});

describe("nextEpisode", () => {
  const seasons = [
    { id: "s0", number: 0, name: "Specials", episodes: [{ id: "x:0:1", number: 1, title: "sp" }] },
    { id: "s1", number: 1, name: "Season 1", episodes: [
      { id: "x:1:1", number: 1, title: "a" },
      { id: "x:1:2", number: 2, title: "b" },
    ]},
    { id: "s2", number: 2, name: "Season 2", episodes: [{ id: "x:2:1", number: 1, title: "c" }] },
  ];
  it("advances within a season, then across seasons", () => {
    expect(nextEpisode(seasons, "x:1:1")?.episode.id).toBe("x:1:2");
    const cross = nextEpisode(seasons, "x:1:2");
    expect(cross?.episode.id).toBe("x:2:1");
    expect(cross?.season.number).toBe(2);
  });
  it("ends at the series end and never rolls INTO specials", () => {
    expect(nextEpisode(seasons, "x:2:1")).toBeNull();
    expect(nextEpisode(seasons, "nope")).toBeNull();
  });
});

describe("nextUpEpisode", () => {
  const seasons = mapSeasons([
    { id: "tt1:0:1", season: 0, episode: 1, name: "Special" },
    { id: "tt1:1:1", season: 1, episode: 1, name: "a" },
    { id: "tt1:1:2", season: 1, episode: 2, name: "b" },
    { id: "tt1:2:1", season: 2, episode: 1, name: "c" },
  ]);

  it("resumes an unfinished last-played episode", () => {
    expect(
      nextUpEpisode(seasons, new Set(), {
        episodeId: "tt1:1:2",
        finished: false,
      }),
    ).toBe("tt1:1:2");
  });

  it("advances past a finished last-played episode", () => {
    expect(
      nextUpEpisode(seasons, new Set(["tt1:1:2"]), {
        episodeId: "tt1:1:2",
        finished: true,
      }),
    ).toBe("tt1:2:1");
  });

  it("falls back to the first unwatched, skipping specials", () => {
    expect(nextUpEpisode(seasons, new Set(["tt1:1:1"]))).toBe("tt1:1:2");
    expect(nextUpEpisode(seasons, new Set())).toBe("tt1:1:1");
  });

  it("null when everything is watched (and after the finale)", () => {
    const all = new Set(["tt1:1:1", "tt1:1:2", "tt1:2:1"]);
    expect(nextUpEpisode(seasons, all)).toBeNull();
    expect(
      nextUpEpisode(seasons, all, { episodeId: "tt1:2:1", finished: true }),
    ).toBeNull();
  });
});
