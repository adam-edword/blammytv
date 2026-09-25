import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VodData, VodItem } from "./model";

// The Stream tab's build pipeline against an in-mock Stremio addon: rows
// from browseable catalogs only, per-catalog isolation, hero enrichment,
// the Cinemeta fallback for sparse metas, and credential-scrubbed errors.

const httpGetJson = vi.fn();
vi.mock("../../lib/http", () => ({
  httpGetJson: (...a: unknown[]) => httpGetJson(...a),
  httpGetText: vi.fn(),
}));
let aioUrl = "http://aio.example/u/SECRETCONFIG/manifest.json";
let heroSources: string[] = [];
vi.mock("../settings/aiostreams", () => ({
  loadAioUrl: () => aioUrl,
  loadHeroSources: () => heroSources,
}));

const MANIFEST = {
  id: "fake",
  name: "Fake",
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    { type: "movie", id: "top-movies", name: "Top Movies" },
    { type: "series", id: "top-series", name: "Top Series" },
    { type: "movie", id: "search-only", name: "Search", extra: [{ name: "search", isRequired: true }] },
    { type: "movie", id: "broken", name: "Broken" },
  ],
};

function installAddon() {
  httpGetJson.mockImplementation((rawUrl: unknown) => {
    const url = String(rawUrl);
    if (url.endsWith("/manifest.json") && url.includes("aio.example"))
      return Promise.resolve(MANIFEST);
    if (url.includes("/catalog/movie/top-movies.json"))
      return Promise.resolve({
        metas: [
          { id: "tt1", type: "movie", name: "Movie One", poster: "http://h/1.png", description: "d" },
          { id: "tt2", type: "movie", name: "Sparse Movie" }, // no poster/synopsis
        ],
      });
    if (url.includes("/catalog/series/top-series.json"))
      return Promise.resolve({
        metas: [{ id: "tt9", type: "series", name: "Show", poster: "http://h/9.png" }],
      });
    if (url.includes("/catalog/movie/broken.json"))
      return Promise.reject(new Error("boom http://aio.example/u/SECRETCONFIG/catalog"));
    if (url.includes("aio.example") && url.includes("/meta/"))
      return Promise.resolve({
        meta: {
          id: url.includes("tt9") ? "tt9" : "tt1",
          type: url.includes("/series/") ? "series" : "movie",
          name: "Enriched",
          background: "http://h/bg.png",
          description: "full synopsis",
        },
      });
    if (url.includes("v3-cinemeta.strem.io/meta/movie/tt2.json"))
      return Promise.resolve({
        meta: { id: "tt2", type: "movie", name: "Sparse Movie", poster: "http://h/cine.png", description: "from cinemeta" },
      });
    if (url.includes("/stream/"))
      return Promise.resolve({
        streams: [
          { name: "1080p", url: "http://h/v.mp4" },
          { name: "magnet", description: "no url" },
        ],
      });
    return Promise.reject(new Error(`unmocked ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  aioUrl = "http://aio.example/u/SECRETCONFIG/manifest.json";
  heroSources = [];
  installAddon();
});

describe("stream source", () => {
  it("builds rows from browseable catalogs; broken one isolates; search-only excluded", async () => {
    const { loadVod } = await import("./source");
    const data = await loadVod();
    expect(data.error).toBeUndefined();
    expect(data.rows.map((r) => r.title)).toEqual(["Top Movies", "Top Series"]);
    // Rows carry the catalog items (tt1 is hero-enriched by now — check
    // membership, not the preview title).
    expect(data.rows[0].itemIds).toContain("tt1");
    expect(data.rows[0].itemIds).toContain("tt2");
  });

  it("returns the hero finished: every pick with its full meta and a backdrop", async () => {
    const { loadVod } = await import("./source");
    const data = await loadVod();
    // tt1, tt2 and tt9 all answer the mock's meta with a background.
    expect(data.featured).toHaveLength(3);
    for (const id of data.featured) {
      expect(data.items.get(id)?.backdrop).toBe("http://h/bg.png");
      expect(data.items.get(id)?.synopsis).toBe("full synopsis");
    }
  });

  it("leaves out a pick whose full meta fails or has no backdrop", async () => {
    const addon = httpGetJson.getMockImplementation()!;
    httpGetJson.mockImplementation((rawUrl: unknown) => {
      const url = String(rawUrl);
      if (url.includes("/meta/movie/tt2.json")) return Promise.reject(new Error("meta down"));
      if (url.includes("/meta/series/tt9.json"))
        return Promise.resolve({ meta: { id: "tt9", type: "series", name: "Show", description: "no art" } });
      return addon(rawUrl);
    });
    const { loadVod } = await import("./source");
    const data = await loadVod();
    expect(data.featured).toEqual(["tt1"]);
    // The rows still carry all three, as the catalog gave them.
    expect(data.rows.flatMap((r) => r.itemIds).sort()).toEqual(["tt1", "tt2", "tt9"]);
  });

  it("waits no longer than 4 seconds on a pick's meta that never answers", async () => {
    vi.useFakeTimers();
    try {
      const addon = httpGetJson.getMockImplementation()!;
      httpGetJson.mockImplementation((rawUrl: unknown) =>
        String(rawUrl).includes("/meta/movie/tt2.json") ? new Promise(() => {}) : addon(rawUrl),
      );
      const { loadVod } = await import("./source");
      let data: Awaited<ReturnType<typeof loadVod>> | undefined;
      void loadVod().then((d) => (data = d));
      await vi.advanceTimersByTimeAsync(3900);
      expect(data).toBeUndefined();
      await vi.advanceTimersByTimeAsync(200);
      expect(data?.featured.sort()).toEqual(["tt1", "tt9"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses row fetches as hero pools — no duplicate catalog round trip", async () => {
    const { loadVod } = await import("./source");
    await loadVod();
    const topMovieFetches = httpGetJson.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/catalog/movie/top-movies.json"));
    expect(topMovieFetches).toHaveLength(1);
  });

  it("persists the build and peeks it back after a fresh start", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      const first = await import("./source");
      await first.loadVod();
      expect(store.size).toBeGreaterThan(0);
      // A new module instance = a fresh launch: memory cache empty, the
      // disk mirror serves the first paint.
      vi.resetModules();
      const second = await import("./source");
      const peeked = second.peekVod();
      expect(peeked?.rows.map((r) => r.title)).toEqual(["Top Movies", "Top Series"]);
      // And its hero is the finished one: the mirror is written after the
      // meta, never before it (a relaunch used to peek bare previews).
      expect(peeked?.featured.length).toBeGreaterThan(0);
      for (const id of peeked!.featured)
        expect(peeked!.items.get(id)?.backdrop).toBe("http://h/bg.png");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to Cinemeta for sparse metas and merges the gaps", async () => {
    // Make the addon return a bare meta for tt2 so the detail is sparse.
    const { resolveVodItem } = await import("./source");
    httpGetJson.mockImplementation((rawUrl: unknown) => {
      const url = String(rawUrl);
      if (url.includes("aio.example") && url.includes("/meta/movie/tt2.json"))
        return Promise.resolve({ meta: { id: "tt2", type: "movie", name: "Sparse Movie" } });
      if (url.includes("v3-cinemeta.strem.io/meta/movie/tt2.json"))
        return Promise.resolve({
          meta: { id: "tt2", type: "movie", name: "Sparse Movie", poster: "http://h/cine.png", description: "from cinemeta" },
        });
      return Promise.reject(new Error(`unmocked ${url}`));
    });
    const item = await resolveVodItem("movie", "tt2");
    expect(item?.poster).toBe("http://h/cine.png");
    expect(item?.synopsis).toBe("from cinemeta");
  });

  it("resolves sources fresh and drops magnet-only entries", async () => {
    const { resolveVodSources } = await import("./source");
    const sources = await resolveVodSources("movie", "tt1");
    expect(sources).toHaveLength(1);
    expect(sources[0].streamUrl).toBe("http://h/v.mp4");
  });

  it("scrubs the manifest URL (a credential) out of failure messages", async () => {
    httpGetJson.mockRejectedValue(
      new Error("connect refused http://aio.example/u/SECRETCONFIG/manifest.json"),
    );
    const { loadVod } = await import("./source");
    const data = await loadVod();
    expect(data.error).toBeTruthy();
    expect(data.error).not.toContain("SECRETCONFIG");
  });

  it("accepts type/id-keyed hero sources (the Settings picker's format)", async () => {
    heroSources = ["movie/top-movies"]; // key form, not bare id
    const { loadVod } = await import("./source");
    const data = await loadVod();
    expect(data.featured.length).toBeGreaterThan(0);
  });

  it("ignores a version-1 mirror, which could hold a hero of bare previews", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      const { configKey, peekVod } = await import("./source");
      const preview = { id: "tt1", title: "Movie One", kind: "movie", poster: "http://h/1.png", genres: [], cast: [], seasons: [] };
      store.set(
        "blammytv.vodCache",
        JSON.stringify({ v: 1, data: { key: configKey(), at: Date.now(), items: [preview], rows: [], featured: ["tt1"] } }),
      );
      expect(peekVod()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns an empty, error-free surface when no manifest is configured", async () => {
    aioUrl = "";
    const { loadVod } = await import("./source");
    const data = await loadVod();
    expect(data.error).toBeUndefined();
    expect(data.rows).toEqual([]);
  });
});

describe("keepHero", () => {
  const item = (id: string, backdrop?: string): VodItem => ({
    id, title: id, kind: "movie", backdrop, genres: [], cast: [], seasons: [],
  });
  const data = (featured: string[], items: VodItem[]): VodData => ({
    items: new Map(items.map((i) => [i.id, i])),
    rows: [{ id: "aio:r", title: "Row", layout: "poster", itemIds: items.map((i) => i.id) }],
    featured,
  });

  it("keeps the titles on screen, with their full meta, and takes the new rows", async () => {
    const { keepHero } = await import("./source");
    const shown = data(["a", "b"], [item("a", "bg-a"), item("b", "bg-b")]);
    const next = data(["c"], [item("a"), item("c", "bg-c"), item("d")]);
    const out = keepHero(shown, next);
    expect(out.featured).toEqual(["a", "b"]);
    expect(out.items.get("a")?.backdrop).toBe("bg-a");
    expect(out.items.get("b")?.backdrop).toBe("bg-b");
    expect(out.rows).toBe(next.rows);
    expect(out.items.get("d")).toBeDefined();
    // The build's own map is not touched: the cache and the mirror keep
    // the new picks for the next time the tab opens.
    expect(next.items.get("a")?.backdrop).toBeUndefined();
  });

  it("takes the new build when nothing was on screen, or no hero was", async () => {
    const { keepHero } = await import("./source");
    const next = data(["c"], [item("c", "bg-c")]);
    expect(keepHero(null, next)).toBe(next);
    expect(keepHero(data([], [item("a")]), next)).toBe(next);
    expect(keepHero(next, next)).toBe(next);
  });
});
