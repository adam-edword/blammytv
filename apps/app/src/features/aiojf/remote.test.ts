import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourcesReply } from "./client";
import { packEpisode, packMovie, packSeries } from "./ids";
import type { BaseItem } from "./rules";

// An in-memory localStorage: the unit tests run without a DOM. The id map
// (idmap.ts) is kept in it.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

// AIOStreams' Jellyfin side, as far as remote.ts asks it: `aioCall` answers
// from `serve`, and every call is kept.
interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
}
const calls: Call[] = [];
let serve: (c: Call) => { status?: number; data?: unknown };
const sourcesAsked: { id: string; refresh: boolean }[] = [];
let sourcesReply: SourcesReply = { status: 200, sources: [] };

vi.mock("./account", () => ({
  aioCall: async (method: string, path: string, opts: { query?: Record<string, string> } = {}) => {
    const c = { method, path, query: opts.query ?? {} };
    calls.push(c);
    const r = serve(c);
    const status = r.status ?? 200;
    return { status, data: status >= 200 && status < 300 ? (r.data ?? null) : null, reply: { status, body: "" } };
  },
  aioSources: async (id: string, refresh: boolean) => {
    sourcesAsked.push({ id, refresh });
    return sourcesReply;
  },
}));

import { forgetViews, remoteCatalog, remoteManifest, remoteMeta, remoteStreams } from "./remote";
import type { SignInConn } from "./conn";

const conn: SignInConn = { kind: "signin", base: "https://aio.example.com/jellyfin", key: "signin:https://aio.example.com/jellyfin|Adam" };

function must<V>(v: V | null | undefined): V {
  if (v == null) throw new Error("a fixture did not decode");
  return v;
}

const MIN = 600_000_000;
const view = (over: BaseItem = {}): BaseItem => ({
  Id: "a2" + "1".repeat(30),
  Name: "Popular Movies",
  Type: "CollectionFolder",
  Path: "/aiostreams/movie/tmdb.top",
  ...over,
});
const film = (over: BaseItem = {}): BaseItem => ({
  Id: must(packMovie("tt0111161")),
  Type: "Movie",
  Name: "The Shawshank Redemption",
  Overview: "Two imprisoned men bond.",
  ProductionYear: 1994,
  RunTimeTicks: 142 * MIN,
  Genres: ["Drama"],
  People: [{ Name: "Tim Robbins", Type: "Actor" }],
  ImageTags: { Primary: "abcdefghijk2dzUwMC9zaGF3c2hhbmsuanBn" },
  Path: "/aiostreams/movie/tt0111161/The Shawshank Redemption.mkv",
  ...over,
});
const show = (over: BaseItem = {}): BaseItem => ({
  Id: must(packSeries("tt0903747")),
  Type: "Series",
  Name: "Breaking Bad",
  Path: "/aiostreams/series/tt0903747/Breaking Bad",
  ...over,
});
const ep = (id: string, season: number, n: number, over: BaseItem = {}): BaseItem => ({
  Id: id,
  Type: "Episode",
  Name: `Episode ${n}`,
  IndexNumber: n,
  ParentIndexNumber: season,
  ...over,
});
const list = (items: BaseItem[], total = items.length) => ({ data: { Items: items, TotalRecordCount: total } });

/** The library the tests below read: two views, one of them required-genre. */
const VIEWS = [
  view(),
  view({ Id: "a2" + "2".repeat(30), Name: "Shows", Path: "/aiostreams/series/trakt.shows" }),
  view({ Id: "a2" + "3".repeat(30), Name: "By genre", Path: "/aiostreams/movie/by.genre", aiostreams: { genreRequired: true } }),
  view({ Id: "a2" + "4".repeat(30), Name: "Anime", Path: "/aiostreams/anime/kitsu.trending" }),
];
const GENRES: Record<string, string[]> = {
  ["a2" + "1".repeat(30)]: ["Action", "Drama"],
  ["a2" + "2".repeat(30)]: ["Comedy"],
  ["a2" + "3".repeat(30)]: ["Western", "Noir"],
};

beforeEach(() => {
  mem.clear();
  calls.length = 0;
  sourcesAsked.length = 0;
  sourcesReply = { status: 200, sources: [] };
  forgetViews();
  serve = (c) => {
    if (c.path === "/UserViews") return list(VIEWS);
    if (c.path === "/Genres") return list((GENRES[c.query.ParentId] ?? []).map((Name) => ({ Name })));
    return { status: 404 };
  };
});

describe("remoteManifest", () => {
  it("lists the views as catalogs in the config's order, with the search catalogs last", async () => {
    const m = await remoteManifest(conn);
    expect(m.catalogs.map((c) => `${c.type}/${c.id}`)).toEqual([
      "movie/tmdb.top",
      "series/trakt.shows",
      "movie/by.genre",
      "anime/kitsu.trending",
      "movie/aiojf.search.movie",
      "series/aiojf.search.series",
    ]);
  });

  it("reads genres for the movie and series views only, as the genre extra's options", async () => {
    const m = await remoteManifest(conn);
    expect(calls.filter((c) => c.path === "/Genres").map((c) => c.query.ParentId).sort()).toEqual(
      ["a2" + "1".repeat(30), "a2" + "2".repeat(30), "a2" + "3".repeat(30)].sort(),
    );
    expect(m.catalogs[0].extra).toEqual([{ name: "genre", options: ["Action", "Drama"] }, { name: "skip" }]);
    expect(m.catalogs[2].extra).toEqual([{ name: "genre", isRequired: true, options: ["Western", "Noir"] }, { name: "skip" }]);
    // An anime view is not browsed by Discover, so its genres are not asked.
    expect(m.catalogs[3].extra).toEqual([{ name: "skip" }]);
  });

  it("holds the views, so the next ask costs nothing, and asks again for another sign-in", async () => {
    await remoteManifest(conn);
    const n = calls.length;
    await remoteManifest(conn);
    expect(calls.length).toBe(n);
    await remoteManifest({ ...conn, key: "signin:https://aio.example.com/jellyfin|Eve" });
    expect(calls.length).toBeGreaterThan(n);
  });

  it("a genre list that fails leaves that catalog without options, not the manifest without it", async () => {
    serve = (c) => (c.path === "/UserViews" ? list(VIEWS) : { status: 500 });
    const m = await remoteManifest(conn);
    expect(m.catalogs.length).toBe(VIEWS.length + 2);
    expect(m.catalogs[0].extra).toEqual([{ name: "skip" }]);
  });

  it("a views list that fails is an error, and is not held", async () => {
    serve = () => ({ status: 503 });
    await expect(remoteManifest(conn)).rejects.toThrow("AIOStreams answered 503 for your catalogs");
    serve = (c) => (c.path === "/UserViews" ? list(VIEWS) : list([]));
    await expect(remoteManifest(conn)).resolves.toBeTruthy();
  });

  it("a 401 says so", async () => {
    serve = () => ({ status: 401 });
    await expect(remoteManifest(conn)).rejects.toThrow("Signed out of AIOStreams");
  });
});

describe("remoteCatalog", () => {
  const items = () => {
    serve = (c) => {
      if (c.path === "/UserViews") return list(VIEWS);
      if (c.path === "/Genres") return list((GENRES[c.query.ParentId] ?? []).map((Name) => ({ Name })));
      if (c.path === "/Items") return list([film()]);
      return { status: 404 };
    };
  };

  it("a page is the view's items, from its ParentId, StartIndex and Limit", async () => {
    items();
    const r = await remoteCatalog(conn, "movie", "tmdb.top", undefined, 40);
    const asked = calls.find((c) => c.path === "/Items");
    expect(asked?.query).toEqual({ ParentId: "a2" + "1".repeat(30), StartIndex: "0", Limit: "40" });
    expect(r.metas?.map((m) => [m.id, m.type, m.name])).toEqual([["tt0111161", "movie", "The Shawshank Redemption"]]);
    expect(r.metas?.[0].poster).toMatch(/^https:\/\/aio\.example\.com\/jellyfin\/Items\/.+\/Images\/Primary\?tag=/);
  });

  it("asks a Discover page when no number is given", async () => {
    items();
    await remoteCatalog(conn, "movie", "tmdb.top");
    expect(calls.find((c) => c.path === "/Items")?.query.Limit).toBe("40");
  });

  it("never asks for more than AIOStreams answers", async () => {
    items();
    await remoteCatalog(conn, "movie", "tmdb.top", undefined, 5000);
    expect(calls.find((c) => c.path === "/Items")?.query.Limit).toBe("250");
  });

  it("a genre and a skip are Genres and StartIndex", async () => {
    items();
    await remoteCatalog(conn, "movie", "tmdb.top", `genre=${encodeURIComponent("Sci-Fi & Fantasy")}&skip=80`, 40);
    expect(calls.find((c) => c.path === "/Items")?.query).toEqual({
      ParentId: "a2" + "1".repeat(30),
      StartIndex: "80",
      Limit: "40",
      Genres: "Sci-Fi & Fantasy",
    });
  });

  it("the hero's genre=None is no genre on a catalog that needs none", async () => {
    items();
    await remoteCatalog(conn, "movie", "tmdb.top", "genre=None", 40);
    expect(calls.find((c) => c.path === "/Items")?.query.Genres).toBeUndefined();
  });

  it("and the first of its genres on a catalog that requires one, which answers nothing without", async () => {
    items();
    await remoteCatalog(conn, "movie", "by.genre", "genre=None", 40);
    expect(calls.find((c) => c.path === "/Items")?.query.Genres).toBe("Western");
  });

  it("a search is a SearchTerm over every library, of the one kind", async () => {
    items();
    await remoteCatalog(conn, "movie", "aiojf.search.movie", `search=${encodeURIComponent("iron man")}`);
    expect(calls.find((c) => c.path === "/Items")?.query).toEqual({
      SearchTerm: "iron man",
      IncludeItemTypes: "Movie",
      Recursive: "true",
      Limit: "40",
    });
    calls.length = 0;
    await remoteCatalog(conn, "series", "aiojf.search.series", "search=lost");
    expect(calls.find((c) => c.path === "/Items")?.query.IncludeItemTypes).toBe("Series");
    // The views are not asked for: nothing about a search needs them.
    expect(calls.some((c) => c.path === "/UserViews")).toBe(false);
  });

  it("a search for nothing asks nothing", async () => {
    items();
    expect(await remoteCatalog(conn, "movie", "aiojf.search.movie", "search=%20")).toEqual({ metas: [] });
    expect(calls.length).toBe(0);
  });

  it("a catalog the config does not have is an error", async () => {
    items();
    await expect(remoteCatalog(conn, "movie", "gone")).rejects.toThrow('AIOStreams has no catalog "gone"');
  });

  it("a page that fails is an error", async () => {
    serve = (c) => (c.path === "/UserViews" ? list(VIEWS) : c.path === "/Genres" ? list([]) : { status: 500 });
    await expect(remoteCatalog(conn, "movie", "tmdb.top")).rejects.toThrow("AIOStreams answered 500 for a catalog");
  });

  it("what is not a film or a show is left out of the page", async () => {
    serve = (c) =>
      c.path === "/UserViews" ? list(VIEWS) : c.path === "/Genres" ? list([]) : list([film(), { Id: "x", Type: "Person", Name: "Nobody" }]);
    const r = await remoteCatalog(conn, "movie", "tmdb.top");
    expect(r.metas?.length).toBe(1);
  });
});

describe("remoteMeta", () => {
  const HASHED = "b2" + "7".repeat(30);
  const hashedFilm = film({ Id: HASHED, Name: "Addon Only", Path: "/aiostreams/movie/custom:abc/Addon Only.mkv" });

  it("a single item is always asked with Fields, and never with MediaSources", async () => {
    serve = () => ({ data: film() });
    const r = await remoteMeta(conn, "movie", "tt0111161");
    const asked = calls.filter((c) => /^\/Items\/[0-9a-f]{32}$/.test(c.path));
    expect(asked.length).toBe(1);
    expect(asked[0].path).toBe(`/Items/${must(packMovie("tt0111161"))}`);
    expect(asked[0].query.Fields).toBeTruthy();
    expect(asked[0].query.Fields.toLowerCase()).not.toContain("mediasources");
    expect(r.meta).toMatchObject({ id: "tt0111161", name: "The Shawshank Redemption", genres: ["Drama"], cast: ["Tim Robbins"] });
  });

  it("a show also reads its episodes, in the Stremio video ids", async () => {
    const e1 = must(packEpisode("tt0903747:1:1"));
    const e2 = must(packEpisode("tt0903747:1:2"));
    serve = (c) => (c.path.endsWith("/Episodes") ? list([ep(e1, 1, 1), ep(e2, 1, 2)]) : { data: show() });
    const r = await remoteMeta(conn, "series", "tt0903747");
    const eps = calls.find((c) => c.path.endsWith("/Episodes"));
    expect(eps?.path).toBe(`/Shows/${must(packSeries("tt0903747"))}/Episodes`);
    expect(eps?.query).toEqual({ Limit: "2000", StartIndex: "0" });
    expect(r.meta?.videos?.map((v) => [v.id, v.season, v.episode])).toEqual([
      ["tt0903747:1:1", 1, 1],
      ["tt0903747:1:2", 1, 2],
    ]);
  });

  it("a show longer than one answer is read in pages", async () => {
    const mk = (n: number) => ep(must(packEpisode(`tt0903747:1:${n}`)), 1, n);
    serve = (c) => {
      if (!c.path.endsWith("/Episodes")) return { data: show() };
      return c.query.StartIndex === "0" ? list([mk(1), mk(2)], 3) : list([mk(3)], 3);
    };
    const r = await remoteMeta(conn, "series", "tt0903747");
    expect(r.meta?.videos?.length).toBe(3);
    expect(calls.filter((c) => c.path.endsWith("/Episodes")).map((c) => c.query.StartIndex)).toEqual(["0", "2"]);
  });

  it("skips the episodes for a caller that only wants the art", async () => {
    serve = () => ({ data: show() });
    const r = await remoteMeta(conn, "series", "tt0903747", { episodes: false });
    expect(calls.some((c) => c.path.endsWith("/Episodes"))).toBe(false);
    expect(r.meta?.videos).toEqual([]);
  });

  it("a title AIOStreams does not have answers no meta", async () => {
    serve = () => ({ status: 404 });
    expect(await remoteMeta(conn, "movie", "tt0111161")).toEqual({});
  });

  it("an id it cannot name answers no meta and asks nothing", async () => {
    expect(await remoteMeta(conn, "movie", "custom:abc")).toEqual({});
    expect(calls.length).toBe(0);
  });

  it("a hashed title is found by the id its list gave, and then opens by it", async () => {
    serve = (c) => {
      if (c.path === "/UserViews") return list(VIEWS);
      if (c.path === "/Genres") return list([]);
      if (c.path === "/Items") return list([hashedFilm]);
      return c.path === `/Items/${HASHED}` ? { data: hashedFilm } : { status: 404 };
    };
    const page = await remoteCatalog(conn, "movie", "tmdb.top");
    expect(page.metas?.[0].id).toBe("custom:abc");
    const r = await remoteMeta(conn, "movie", "custom:abc");
    expect(r.meta?.name).toBe("Addon Only");
    expect(calls.some((c) => c.path === `/Items/${HASHED}`)).toBe(true);
  });

  it("a Kitsu-style episode is found by the id its show's episode list gave, season and all", async () => {
    const kitsuShow = show({ Id: must(packSeries("kitsu:7442", "anime")), Path: "/aiostreams/anime/kitsu:7442/Attack" });
    const e = must(packEpisode("kitsu:7442:3", { type: "anime", season: 2 }));
    serve = (c) => (c.path.endsWith("/Episodes") ? list([ep(e, 2, 3)]) : { data: kitsuShow });
    const r = await remoteMeta(conn, "series", "kitsu:7442");
    expect(r.meta?.videos?.[0].id).toBe("kitsu:7442:3");
    // Season 2, which kitsu:7442:3 alone would not say.
    await remoteStreams(conn, "series", "kitsu:7442:3");
    expect(sourcesAsked.at(-1)?.id).toBe(e);
  });

  it("a failure other than not found is an error", async () => {
    serve = () => ({ status: 502 });
    await expect(remoteMeta(conn, "movie", "tt0111161")).rejects.toThrow("AIOStreams answered 502 for this title");
  });

  it("a show whose episodes fail is an error, not a show with none", async () => {
    serve = (c) => (c.path.endsWith("/Episodes") ? { status: 500 } : { data: show() });
    await expect(remoteMeta(conn, "series", "tt0903747")).rejects.toThrow("episodes");
  });
});

describe("remoteStreams", () => {
  const source = (over: Record<string, unknown> = {}) => ({
    Id: "s1",
    Type: "Default",
    Path: "https://cdn.example.com/a.mkv",
    Name: "4K\nline",
    Size: 8_000_000_000,
    aiostreams: { name: "4K", description: "line", cached: true, service: "rd", bingeGroup: "g|2160p" },
    ...over,
  });

  it("asks for the title's own id, and a plain open does not ask to refresh", async () => {
    sourcesReply = { status: 200, sources: [source()] as never };
    const r = await remoteStreams(conn, "movie", "tt0111161");
    expect(sourcesAsked).toEqual([{ id: must(packMovie("tt0111161")), refresh: false }]);
    expect(r.streams).toEqual([
      expect.objectContaining({
        name: "4K",
        description: "line",
        url: "https://cdn.example.com/a.mkv",
        streamData: { service: { id: "rd", cached: true } },
      }),
    ]);
  });

  it("Retry's refresh is passed on", async () => {
    await remoteStreams(conn, "movie", "tt0111161", { refresh: true });
    expect(sourcesAsked[0].refresh).toBe(true);
  });

  it("an episode is asked by its packed id, and a hashed one by its own hex", async () => {
    await remoteStreams(conn, "series", "tt0903747:2:5");
    expect(sourcesAsked.at(-1)?.id).toBe(must(packEpisode("tt0903747:2:5")));
    const hex = "b2" + "9".repeat(30);
    await remoteStreams(conn, "series", `aiojf:${hex}`);
    expect(sourcesAsked.at(-1)?.id).toBe(hex);
  });

  it("a placeholder is not a source", async () => {
    sourcesReply = { status: 200, sources: [source({ Type: "Placeholder", Path: "https://aio.example.com/notice" }), source()] as never };
    expect((await remoteStreams(conn, "movie", "tt0111161")).streams?.length).toBe(1);
  });

  it("not found, and NoCompatibleStream, are an empty list", async () => {
    sourcesReply = { status: 404, sources: [], errorCode: "NotAllowed" };
    expect(await remoteStreams(conn, "movie", "tt0111161")).toEqual({ streams: [] });
    sourcesReply = { status: 200, sources: [source({ Type: "Placeholder" })] as never, errorCode: "NoCompatibleStream" };
    expect(await remoteStreams(conn, "movie", "tt0111161")).toEqual({ streams: [] });
  });

  it("a rate limit is an error that says AIOStreams is busy", async () => {
    sourcesReply = { status: 429, sources: [] };
    await expect(remoteStreams(conn, "movie", "tt0111161")).rejects.toThrow("busy");
    await expect(remoteStreams(conn, "movie", "tt0111161")).rejects.toThrow("Try again in a few seconds");
  });

  it("any other failure is an error", async () => {
    sourcesReply = { status: 500, sources: [] };
    await expect(remoteStreams(conn, "movie", "tt0111161")).rejects.toThrow("AIOStreams answered 500 for sources");
  });

  it("an id it cannot name asks nothing", async () => {
    expect(await remoteStreams(conn, "movie", "custom:abc")).toEqual({ streams: [] });
    expect(sourcesAsked.length).toBe(0);
  });
});
