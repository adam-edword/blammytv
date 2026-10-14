import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VodItem } from "../stream/model";

const m = vi.hoisted(() => ({
  aioConn: null as null | { key: string; kind: string },
  jfConn: null as null | { base: string; userId: string; key: string },
  manifest: vi.fn(),
  aioCatalog: vi.fn(),
  cinemeta: vi.fn(),
  loadJfDiscover: vi.fn(),
  fetchJfPage: vi.fn(),
  searchJf: vi.fn(),
  peekJfVod: vi.fn(),
  peekVod: vi.fn(),
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
  loadJfDiscover: m.loadJfDiscover,
  fetchJfPage: m.fetchJfPage,
  searchJf: m.searchJf,
  peekJfVod: m.peekJfVod,
}));
vi.mock("../stream/source", () => ({ peekVod: m.peekVod }));

import {
  clearSearchCache,
  discoverKey,
  fetchDiscoverPage,
  itemKey,
  loadDiscover,
  searchDiscover,
  seedFromStream,
  type DiscoverConfig,
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
const jf = (id: string, over: Partial<VodItem> = {}): VodItem => film(id, { from: "jf", ...over });

const MANIFEST = {
  catalogs: [
    { type: "movie", id: "top", extra: [{ name: "genre", options: ["Action", "Drama"] }, { name: "search" }] },
    { type: "series", id: "tv", extra: [{ name: "genre", options: ["Drama"] }] },
  ],
};
const LIB_MOVIES = "a".repeat(32);
const LIB_SHOWS = "b".repeat(32);
const JF = {
  conn: { base: "https://jf.example.com", userId: "u".repeat(32), key: "jf:k" },
  catalogs: [
    { type: "movie" as const, id: LIB_MOVIES, name: "Movies" },
    { type: "series" as const, id: LIB_SHOWS, name: "Shows" },
  ],
  genres: ["drama", "Thriller"],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.aioConn = null;
  m.jfConn = null;
  clearSearchCache();
  m.manifest.mockResolvedValue(MANIFEST);
  m.loadJfDiscover.mockResolvedValue(JF);
  m.fetchJfPage.mockResolvedValue([]);
  m.searchJf.mockResolvedValue([]);
  m.aioCatalog.mockResolvedValue({ metas: [] });
  m.cinemeta.mockResolvedValue({ metas: [] });
  m.peekVod.mockReturnValue(null);
  m.peekJfVod.mockReturnValue(null);
});

describe("loadDiscover with a Jellyfin", () => {
  it("is the addon's own config, untouched, with no Jellyfin", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    const cfg = await loadDiscover();
    expect(cfg.catalogs.every((c) => !c.from)).toBe(true);
    expect(cfg.genres).toEqual(["Action", "Drama"]);
    expect(cfg.searchCatalogs.map((c) => c.id)).toEqual(["top"]);
    expect(m.loadJfDiscover).not.toHaveBeenCalled();
  });

  it("adds each library as a catalog marked from Jellyfin, taking any genre", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.jfConn = JF.conn;
    const cfg = await loadDiscover();
    const jfCats = cfg.catalogs.filter((c) => c.from === "jf");
    expect(jfCats.map((c) => [c.type, c.id])).toEqual([
      ["movie", LIB_MOVIES],
      ["series", LIB_SHOWS],
    ]);
    for (const c of jfCats) expect(c).toMatchObject({ genreCapable: true, genres: [] });
    expect(cfg.catalogs.slice(0, 2).every((c) => !c.from)).toBe(true);
  });

  it("puts the addon's genres first, then the ones only Jellyfin's titles carry", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.jfConn = JF.conn;
    // "drama" is the addon's "Drama" in another case: one pill, the addon's.
    expect((await loadDiscover()).genres).toEqual(["Action", "Drama", "Thriller"]);
  });

  it("searches each type it has a library for, across every library", async () => {
    m.jfConn = JF.conn;
    const cfg = await loadDiscover();
    expect(cfg.conn).toBeNull();
    expect(cfg.searchCatalogs.map((c) => [c.type, c.from])).toEqual([
      ["movie", "jf"],
      ["series", "jf"],
    ]);
  });

  it("works with only a Jellyfin: no manifest is asked for", async () => {
    m.jfConn = JF.conn;
    const cfg = await loadDiscover();
    expect(m.manifest).not.toHaveBeenCalled();
    expect(cfg.genres).toEqual(["drama", "Thriller"]);
  });

  it("keeps the addon when the Jellyfin cannot be read, and the Jellyfin when the addon cannot", async () => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.jfConn = JF.conn;
    m.loadJfDiscover.mockRejectedValue(new Error("Jellyfin answered 500"));
    expect((await loadDiscover()).catalogs.every((c) => !c.from)).toBe(true);
    m.loadJfDiscover.mockResolvedValue(JF);
    m.manifest.mockRejectedValue(new Error("addon down"));
    const cfg = await loadDiscover();
    expect(cfg.catalogs.every((c) => c.from === "jf")).toBe(true);
    expect(cfg.conn).not.toBeNull();
  });

  it("throws what went wrong when neither gives a catalog", async () => {
    m.jfConn = JF.conn;
    m.loadJfDiscover.mockRejectedValue(new Error("Jellyfin has signed you out"));
    await expect(loadDiscover()).rejects.toThrow("Jellyfin has signed you out");
  });

  it("says there is nothing to browse for a Jellyfin with no libraries", async () => {
    m.jfConn = JF.conn;
    m.loadJfDiscover.mockResolvedValue({ ...JF, catalogs: [], genres: [] });
    await expect(loadDiscover()).rejects.toThrow(/no movie or show libraries/);
  });

  it("keeps the old message when nothing is signed in, which the screen matches", async () => {
    await expect(loadDiscover()).rejects.toThrow("no addon configured");
  });
});

describe("discoverKey", () => {
  it("is empty with nothing, and names both sources, no secret, otherwise", () => {
    expect(discoverKey()).toBe("");
    m.aioConn = { key: "aio-key", kind: "manifest" };
    expect(discoverKey()).toBe("aio-key|");
    m.jfConn = JF.conn;
    expect(discoverKey()).toBe("aio-key|jf:k");
    m.aioConn = null;
    expect(discoverKey()).toBe("|jf:k");
  });
});

describe("pages and search", () => {
  const cfg = async (): Promise<DiscoverConfig> => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.jfConn = JF.conn;
    return loadDiscover();
  };

  it("pages a Jellyfin library from the server, and an addon one from the addon", async () => {
    const c = await cfg();
    m.fetchJfPage.mockResolvedValue([jf("tt1")]);
    m.aioCatalog.mockResolvedValue({ metas: [{ id: "tt2", type: "movie", name: "Two" }] });
    const lib = c.catalogs.find((x) => x.from === "jf" && x.type === "movie")!;
    const got = await fetchDiscoverPage(c, lib, "Drama", 50);
    expect(got.map((i) => [i.id, i.from])).toEqual([["tt1", "jf"]]);
    expect(m.fetchJfPage).toHaveBeenCalledWith(lib, "Drama", 50);
    expect(m.aioCatalog).not.toHaveBeenCalled();
    const top = c.catalogs.find((x) => !x.from && x.type === "movie")!;
    const other = await fetchDiscoverPage(c, top, null, 0);
    expect(other.map((i) => [i.id, i.from])).toEqual([["tt2", undefined]]);
  });

  it("lets a failed Jellyfin page reject, so the grid can tell a blip from an empty library", async () => {
    const c = await cfg();
    m.fetchJfPage.mockRejectedValue(new Error("Jellyfin answered 500"));
    const lib = c.catalogs.find((x) => x.from === "jf")!;
    await expect(fetchDiscoverPage(c, lib, null, 0)).rejects.toThrow("Jellyfin answered 500");
  });

  it("searches the server beside the addon, and keeps the same title from both as two cards", async () => {
    const c = await cfg();
    m.searchJf.mockImplementation(async (type: string) => (type === "movie" ? [jf("tt0111161", { title: "The Shawshank Redemption" })] : []));
    m.aioCatalog.mockResolvedValue({ metas: [{ id: "tt0111161", type: "movie", name: "The Shawshank Redemption" }] });
    const out = await searchDiscover(c, "movie", "shawshank");
    expect(m.searchJf).toHaveBeenCalledWith("movie", "shawshank");
    expect(out.filter((i) => i.id === "tt0111161").map((i) => i.from ?? "addon").sort()).toEqual(["addon", "jf"]);
  });

  it("asks the server for the type that was filtered to, and no other", async () => {
    const c = await cfg();
    await searchDiscover(c, "series", "severance");
    // (A thin answer is asked again, wider, so the same type may be asked twice.)
    expect(new Set(m.searchJf.mock.calls.map((a) => a[0]))).toEqual(new Set(["series"]));
  });

  it("survives the server failing a search", async () => {
    const c = await cfg();
    m.searchJf.mockRejectedValue(new Error("down"));
    m.aioCatalog.mockResolvedValue({ metas: [{ id: "tt1", type: "movie", name: "Heat" }] });
    const out = await searchDiscover(c, "movie", "heat");
    expect(out.map((i) => i.id)).toContain("tt1");
  });
});

describe("itemKey", () => {
  it("tells the same id from two sources apart", () => {
    expect(itemKey(film("tt1"))).not.toBe(itemKey(jf("tt1")));
    expect(itemKey(jf("tt1"))).toBe(itemKey(jf("tt1")));
  });
});

describe("seedFromStream with Jellyfin rows", () => {
  const cfg = async (): Promise<DiscoverConfig> => {
    m.aioConn = { key: "aio", kind: "manifest" };
    m.jfConn = JF.conn;
    return loadDiscover();
  };
  const data = (rows: { id: string; items: VodItem[] }[]) => ({
    items: new Map(rows.flatMap((r) => r.items).map((i) => [i.id, i])),
    rows: rows.map((r) => ({ id: r.id, title: r.id, layout: "poster" as const, itemIds: r.items.map((i) => i.id) })),
    featured: [],
  });

  it("seeds each Jellyfin library's cursor from its row, beside the addon's", async () => {
    const c = await cfg();
    m.peekVod.mockReturnValue(data([{ id: "aio:top", items: [film("tt1"), film("tt2")] }]));
    m.peekJfVod.mockReturnValue(data([{ id: `jf:${LIB_MOVIES}`, items: [jf("tt9"), jf("jf:cc")] }]));
    const seed = seedFromStream(c, "all");
    expect(seed?.cursors).toEqual({ "movie:top": 2, [`movie:${LIB_MOVIES}`]: 2 });
    expect(seed?.items.map((i) => i.id).sort()).toEqual(["jf:cc", "tt1", "tt2", "tt9"].sort());
  });

  it("keeps a title in both sources as two cards", async () => {
    const c = await cfg();
    m.peekVod.mockReturnValue(data([{ id: "aio:top", items: [film("tt1")] }]));
    m.peekJfVod.mockReturnValue(data([{ id: `jf:${LIB_MOVIES}`, items: [jf("tt1")] }]));
    expect(seedFromStream(c, "all")?.items.map((i) => i.from)).toEqual([undefined, "jf"]);
  });

  it("seeds from Jellyfin alone, and skips a row whose library is gone", async () => {
    m.jfConn = JF.conn;
    const c = await loadDiscover();
    m.peekJfVod.mockReturnValue(
      data([
        { id: `jf:${LIB_MOVIES}`, items: [jf("tt9")] },
        { id: `jf:${"c".repeat(32)}`, items: [jf("tt8")] },
      ]),
    );
    const seed = seedFromStream(c, "all");
    expect(seed?.items.map((i) => i.id)).toEqual(["tt9"]);
    expect(Object.keys(seed?.cursors ?? {})).toEqual([`movie:${LIB_MOVIES}`]);
  });

  it("does not read an addon row as a Jellyfin library, or the other way", async () => {
    const c = await cfg();
    // An addon row whose id happens to be a library's.
    m.peekVod.mockReturnValue(data([{ id: `aio:${LIB_MOVIES}`, items: [film("tt1")] }]));
    expect(seedFromStream(c, "all")).toBeNull();
  });

  it("is null when neither has rows, and honours the type filter", async () => {
    const c = await cfg();
    expect(seedFromStream(c, "all")).toBeNull();
    m.peekJfVod.mockReturnValue(data([{ id: `jf:${LIB_MOVIES}`, items: [jf("tt9")] }]));
    expect(seedFromStream(c, "series")).toBeNull();
  });
});
