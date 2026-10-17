import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VodItem } from "../stream/model";

const m = vi.hoisted(() => ({
  aioConn: null as null | { key: string; kind: string },
  jfConn: null as null | { base: string; userId: string; key: string },
  playlists: [] as { id: string }[],
  xtKey: "",
  manifest: vi.fn(),
  aioCatalog: vi.fn(),
  cinemeta: vi.fn(),
  loadXtDiscover: vi.fn(),
  xtPage: vi.fn(),
  searchXt: vi.fn(),
  peekVod: vi.fn(),
  peekJfVod: vi.fn(),
}));

vi.mock("../aiojf/conn", () => ({ loadAioConn: () => m.aioConn }));
vi.mock("../jellyfin/store", () => ({ loadJfConn: () => m.jfConn }));
vi.mock("../../data/aio", () => ({
  aioManifest: m.manifest,
  aioCatalog: m.aioCatalog,
  aioMeta: vi.fn().mockResolvedValue({ meta: {} }),
}));
vi.mock("../../data/stremio", async (orig) => ({
  ...(await orig<typeof import("../../data/stremio")>()),
  fetchCatalog: m.cinemeta,
}));
vi.mock("../jellyfin/vod", () => ({
  loadJfDiscover: vi.fn(),
  fetchJfPage: vi.fn(),
  searchJf: vi.fn().mockResolvedValue([]),
  peekJfVod: m.peekJfVod,
}));
vi.mock("../stream/source", () => ({ peekVod: m.peekVod }));
vi.mock("../xtvod/store", () => ({ eligiblePlaylists: () => m.playlists }));
vi.mock("../xtvod/vod", () => ({
  loadXtDiscover: m.loadXtDiscover,
  xtPage: m.xtPage,
  searchXt: m.searchXt,
  xtDiscoverKey: () => m.xtKey,
}));

import {
  catKey,
  clearSearchCache,
  discoverKey,
  fetchDiscoverPage,
  gridCatalogs,
  itemKey,
  loadDiscover,
  searchDiscover,
  seedFromStream,
  servesGenre,
} from "./data";

const film = (id: string, over: Partial<VodItem> = {}): VodItem => ({
  id,
  title: id,
  kind: "movie",
  genres: [],
  cast: [],
  seasons: [],
  ...over,
});
const xt = (id: string, over: Partial<VodItem> = {}): VodItem => film(id, { from: "xt", ...over });

const MANIFEST = {
  catalogs: [
    { type: "movie", id: "top", extra: [{ name: "genre", options: ["Action", "Drama"] }, { name: "search" }] },
    { type: "series", id: "tv", extra: [{ name: "genre", options: ["Drama"] }] },
  ],
};
const BOTH = [
  { type: "movie" as const, id: "pl1" },
  { type: "series" as const, id: "pl1" },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.aioConn = null;
  m.jfConn = null;
  m.playlists = [];
  m.xtKey = "";
  clearSearchCache();
  m.manifest.mockResolvedValue(MANIFEST);
  m.aioCatalog.mockResolvedValue({ metas: [] });
  m.cinemeta.mockResolvedValue({ metas: [] });
  m.loadXtDiscover.mockResolvedValue(BOTH);
  m.xtPage.mockReturnValue([]);
  m.searchXt.mockResolvedValue([]);
  m.peekVod.mockReturnValue(null);
  m.peekJfVod.mockReturnValue(null);
});

describe("loadDiscover with an Xtream library", () => {
  it("is one Movies and one Shows catalog, marked from the playlist, taking no genre", async () => {
    m.playlists = [{ id: "pl1" }];
    const cfg = await loadDiscover();
    expect(cfg.catalogs.map((c) => [c.type, c.id, c.from])).toEqual([
      ["movie", "pl1", "xt"],
      ["series", "pl1", "xt"],
    ]);
    for (const c of cfg.catalogs) expect(c).toMatchObject({ genreCapable: false, genres: [] });
  });

  it("has no genre rail with only a library, and the feeds are in no genre grid", async () => {
    m.playlists = [{ id: "pl1" }];
    const cfg = await loadDiscover();
    expect(cfg.genres).toEqual([]);
    expect(gridCatalogs(cfg.catalogs, "all", "Action")).toEqual([]);
    expect(gridCatalogs(cfg.catalogs, "all", null)).toHaveLength(2);
    expect(gridCatalogs(cfg.catalogs, "movie", null).map((c) => c.type)).toEqual(["movie"]);
    expect(servesGenre(cfg.catalogs[0], "Action")).toBe(false);
  });

  it("leaves the addon's rail alone, and its genre grids to the addon", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.playlists = [{ id: "pl1" }];
    const cfg = await loadDiscover();
    expect(cfg.genres).toEqual(["Action", "Drama"]);
    expect(gridCatalogs(cfg.catalogs, "all", "Drama").every((c) => !c.from)).toBe(true);
    expect(cfg.catalogs.slice(0, 2).every((c) => !c.from)).toBe(true);
    expect(cfg.catalogs.filter((c) => c.from === "xt")).toHaveLength(2);
  });

  it("has a Movies catalog only when the library has movies, and a search for each kind it has", async () => {
    m.playlists = [{ id: "pl1" }];
    m.loadXtDiscover.mockResolvedValue([{ type: "series", id: "pl1" }]);
    const cfg = await loadDiscover();
    expect(cfg.catalogs.map((c) => c.type)).toEqual(["series"]);
    expect(cfg.searchCatalogs.map((c) => [c.type, c.id, c.from])).toEqual([["series", "xt.search.series", "xt"]]);
  });

  it("searches each kind once, across every library, and keeps the addon's search beside it", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.playlists = [{ id: "pl1" }, { id: "pl2" }];
    m.loadXtDiscover.mockResolvedValue([...BOTH, { type: "movie", id: "pl2" }, { type: "series", id: "pl2" }]);
    const cfg = await loadDiscover();
    expect(cfg.searchCatalogs.map((c) => [c.type, c.id, c.from])).toEqual([
      ["movie", "top", undefined],
      ["movie", "xt.search.movie", "xt"],
      ["series", "xt.search.series", "xt"],
    ]);
  });

  it("is the addon's own config, untouched, with no playlist", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    const cfg = await loadDiscover();
    expect(m.loadXtDiscover).not.toHaveBeenCalled();
    expect(cfg.catalogs.every((c) => !c.from)).toBe(true);
    expect(cfg.searchCatalogs.map((c) => c.id)).toEqual(["top"]);
    expect(cfg.xtKey).toBe("");
  });

  it("names the libraries it was made from, for a screen to tell whether they moved", async () => {
    m.playlists = [{ id: "pl1" }];
    m.xtKey = "libs-1";
    expect((await loadDiscover()).xtKey).toBe("libs-1");
  });

  it("does not throw 'no addon configured' when a library is the only source", async () => {
    m.playlists = [{ id: "pl1" }];
    await expect(loadDiscover()).resolves.toBeTruthy();
  });

  it("still does, for someone with no source at all, and for a playlist that is live TV only", async () => {
    await expect(loadDiscover()).rejects.toThrow("no addon configured");
    m.playlists = [{ id: "pl1" }];
    m.loadXtDiscover.mockResolvedValue([]);
    await expect(loadDiscover()).rejects.toThrow("no addon configured");
  });

  it("waits for the playlists' lists only when nothing else can fill Discover", async () => {
    m.playlists = [{ id: "pl1" }];
    await loadDiscover();
    expect(m.loadXtDiscover).toHaveBeenLastCalledWith(true);
    m.aioConn = { key: "aio", kind: "manifest" };
    await loadDiscover();
    expect(m.loadXtDiscover).toHaveBeenLastCalledWith(false);
    m.aioConn = null;
    m.jfConn = { base: "https://jf.example.com", userId: "u".repeat(32), key: "jf:k" };
    await loadDiscover().catch(() => {});
    expect(m.loadXtDiscover).toHaveBeenLastCalledWith(false);
  });

  it("is not held back by a playlist that fails, and does not say it is the addon's fault", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.playlists = [{ id: "pl1" }];
    m.loadXtDiscover.mockResolvedValue([]);
    const cfg = await loadDiscover();
    expect(cfg.catalogs.every((c) => !c.from)).toBe(true);
  });

  it("throws the addon's trouble, not 'no addon configured', when the addon is the only thing that failed", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.playlists = [{ id: "pl1" }];
    m.loadXtDiscover.mockResolvedValue([]);
    m.manifest.mockRejectedValue(new Error("addon down"));
    await expect(loadDiscover()).rejects.toThrow("addon down");
  });
});

describe("discoverKey", () => {
  it("is what it always was without a library", () => {
    expect(discoverKey()).toBe("");
    m.aioConn = { key: "aio-key", kind: "manifest" };
    expect(discoverKey()).toBe("aio-key|");
    m.jfConn = { base: "https://jf.example.com", userId: "u".repeat(32), key: "jf:k" };
    expect(discoverKey()).toBe("aio-key|jf:k");
  });

  it("names the libraries last, and is not empty with only a library", () => {
    m.xtKey = "[libs]";
    expect(discoverKey()).toBe("||[libs]");
    m.aioConn = { key: "aio-key", kind: "manifest" };
    expect(discoverKey()).toBe("aio-key||[libs]");
  });

  it("moves when the libraries do", () => {
    const keys = new Set<string>();
    for (const k of ["", "[a]", "[a,b]", "[a]"]) {
      m.xtKey = k;
      m.aioConn = { key: "aio", kind: "manifest" };
      keys.add(discoverKey());
    }
    expect(keys.size).toBe(3);
  });
});

describe("catKey", () => {
  it("is an addon catalog's key exactly as it has always been", () => {
    expect(catKey({ type: "movie", id: "top" })).toBe("movie:top");
    expect(catKey({ type: "series", id: "top" })).toBe("series:top");
    expect(catKey({ type: "movie", id: "top", from: undefined })).toBe("movie:top");
  });

  it("keeps a Jellyfin library's too", () => {
    expect(catKey({ type: "movie", id: "a".repeat(32), from: "jf" })).toBe(`movie:${"a".repeat(32)}`);
  });

  it("tells an Xtream catalog from an addon one of the same type and id", () => {
    const addon = { type: "movie" as const, id: "pl1" };
    const playlist = { type: "movie" as const, id: "pl1", from: "xt" as const };
    expect(catKey(playlist)).not.toBe(catKey(addon));
    expect(catKey(playlist)).toBe("xt:movie:pl1");
    // So their paging cursors and done marks never meet.
    const cursors: Record<string, number> = { [catKey(addon)]: 50 };
    cursors[catKey(playlist)] = (cursors[catKey(playlist)] ?? 0) + 7;
    expect(cursors).toEqual({ "movie:pl1": 50, "xt:movie:pl1": 7 });
  });

  it("tells a playlist's Movies from its Shows", () => {
    expect(catKey({ type: "movie", id: "pl1", from: "xt" })).not.toBe(catKey({ type: "series", id: "pl1", from: "xt" }));
  });
});

describe("pages and search", () => {
  const cfg = async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.playlists = [{ id: "pl1" }];
    return loadDiscover();
  };

  it("pages a playlist's feed from memory, and the addon's from the addon", async () => {
    const c = await cfg();
    m.xtPage.mockReturnValue([xt("xt:pl1:m:t1")]);
    m.aioCatalog.mockResolvedValue({ metas: [{ id: "tt2", type: "movie", name: "Two" }] });
    const lib = c.catalogs.find((x) => x.from === "xt" && x.type === "movie")!;
    const got = await fetchDiscoverPage(c, lib, null, 50);
    expect(got.map((i) => [i.id, i.from])).toEqual([["xt:pl1:m:t1", "xt"]]);
    expect(m.xtPage).toHaveBeenCalledWith(lib, 50);
    expect(m.aioCatalog).not.toHaveBeenCalled();
    const top = c.catalogs.find((x) => !x.from && x.type === "movie")!;
    expect((await fetchDiscoverPage(c, top, null, 0)).map((i) => i.id)).toEqual(["tt2"]);
  });

  it("pages a playlist's feed with no addon at all", async () => {
    m.playlists = [{ id: "pl1" }];
    const c = await loadDiscover();
    m.xtPage.mockReturnValue([xt("xt:pl1:m:t1")]);
    const lib = c.catalogs.find((x) => x.type === "movie")!;
    expect((await fetchDiscoverPage(c, lib, null, 0)).map((i) => i.id)).toEqual(["xt:pl1:m:t1"]);
  });

  it("searches the library beside the addon, and keeps the same title from both as two cards", async () => {
    const c = await cfg();
    m.searchXt.mockImplementation(async (type: string) => (type === "movie" ? [xt("xt:pl1:m:t9", { title: "Heat" })] : []));
    m.aioCatalog.mockResolvedValue({ metas: [{ id: "tt0113277", type: "movie", name: "Heat" }] });
    const out = await searchDiscover(c, "movie", "heat");
    expect(m.searchXt).toHaveBeenCalledWith("movie", "heat");
    expect(out.map((i) => i.from ?? "addon").sort()).toEqual(["addon", "xt"]);
  });

  it("asks the library for the kind that was filtered to, and no other", async () => {
    const c = await cfg();
    await searchDiscover(c, "series", "severance");
    expect(new Set(m.searchXt.mock.calls.map((a) => a[0]))).toEqual(new Set(["series"]));
  });

  it("searches both kinds for All Content", async () => {
    const c = await cfg();
    await searchDiscover(c, "all", "severance");
    expect(new Set(m.searchXt.mock.calls.map((a) => a[0]))).toEqual(new Set(["movie", "series"]));
  });

  it("asks the addon for nothing when only a library is on, and makes no call to a panel", async () => {
    m.playlists = [{ id: "pl1" }];
    const c = await loadDiscover();
    m.searchXt.mockResolvedValue([xt("xt:pl1:m:t9", { title: "Quiet Harbor" })]);
    const out = await searchDiscover(c, "movie", "quiet harbor");
    expect(out.map((i) => i.title)).toContain("Quiet Harbor");
    expect(m.aioCatalog).not.toHaveBeenCalled();
    expect(m.manifest).not.toHaveBeenCalled();
  });

  it("survives the library failing a search", async () => {
    const c = await cfg();
    m.searchXt.mockRejectedValue(new Error("gone"));
    m.aioCatalog.mockResolvedValue({ metas: [{ id: "tt1", type: "movie", name: "Heat" }] });
    expect((await searchDiscover(c, "movie", "heat")).map((i) => i.id)).toContain("tt1");
  });
});

describe("itemKey", () => {
  it("tells the same id from the addon and from a playlist apart", () => {
    expect(itemKey(film("tt1"))).not.toBe(itemKey(xt("tt1")));
  });
});

describe("seedFromStream with a playlist's library", () => {
  const data = (rows: { id: string; items: VodItem[] }[]) => ({
    items: new Map(rows.flatMap((r) => r.items).map((i) => [i.id, i])),
    rows: rows.map((r) => ({ id: r.id, title: r.id, layout: "poster" as const, itemIds: r.items.map((i) => i.id) })),
    featured: [],
  });
  const both = async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.playlists = [{ id: "pl1" }];
    return loadDiscover();
  };

  it("gives the grid the feeds' first pages with the addon's cached rows, each against its own cursor", async () => {
    const c = await both();
    m.peekVod.mockReturnValue(data([{ id: "aio:top", items: [film("tt1"), film("tt2")] }]));
    m.xtPage.mockImplementation((cat: { type: string }) => (cat.type === "movie" ? [xt("xt:pl1:m:t1")] : [xt("xt:pl1:s:t2", { kind: "series" })]));
    const seed = seedFromStream(c, "all");
    expect(seed?.cursors).toEqual({ "movie:top": 2, "xt:movie:pl1": 1, "xt:series:pl1": 1 });
    expect(seed?.items.map((i) => i.id).sort()).toEqual(["tt1", "tt2", "xt:pl1:m:t1", "xt:pl1:s:t2"]);
  });

  it("seeds from the library alone, and honours the type filter", async () => {
    m.playlists = [{ id: "pl1" }];
    const c = await loadDiscover();
    m.xtPage.mockImplementation((cat: { type: string }) => (cat.type === "movie" ? [xt("xt:pl1:m:t1")] : [xt("xt:pl1:s:t2", { kind: "series" })]));
    expect(seedFromStream(c, "movie")?.items.map((i) => i.id)).toEqual(["xt:pl1:m:t1"]);
    expect(Object.keys(seedFromStream(c, "series")?.cursors ?? {})).toEqual(["xt:series:pl1"]);
  });

  it("is null when the library has nothing in memory to seed from", async () => {
    const c = await both();
    expect(seedFromStream(c, "all")).toBeNull();
  });

  it("does not read an addon row as a library's catalog, or the other way", async () => {
    const c = await both();
    // An addon row whose id happens to be a playlist's.
    m.peekVod.mockReturnValue(data([{ id: "aio:pl1", items: [film("tt1")] }]));
    expect(seedFromStream(c, "all")).toBeNull();
  });
});
