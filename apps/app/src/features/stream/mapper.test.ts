import { describe, expect, it } from "vitest";
import {
  groupSources,
  mapSeasons,
  mapStreams,
  metaPreviewToVod,
  metaToVod,
  nextEpisode,
  nextUpEpisode,
  pickCachedIndex,
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
    expect(seasons[1].episodes[0].airDate).toMatch(/2024/);
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
