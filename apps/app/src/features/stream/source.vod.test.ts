import { beforeEach, describe, expect, it, vi } from "vitest";

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
    // Rows carry the catalog items (tt1 may since be hero-enriched — check
    // membership, not the preview title).
    expect(data.rows[0].itemIds).toContain("tt1");
    expect(data.rows[0].itemIds).toContain("tt2");
    // Hero picks were meta-enriched up-front.
    expect(data.featured.length).toBeGreaterThan(0);
    const enriched = data.featured.map((id) => data.items.get(id)!);
    expect(enriched.some((v) => v.backdrop === "http://h/bg.png")).toBe(true);
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

  it("returns an empty, error-free surface when no manifest is configured", async () => {
    aioUrl = "";
    const { loadVod } = await import("./source");
    const data = await loadVod();
    expect(data.error).toBeUndefined();
    expect(data.rows).toEqual([]);
  });
});
