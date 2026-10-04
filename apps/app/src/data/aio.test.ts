import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AioConn } from "../features/aiojf/conn";

// The one door picks a side by the connection and nothing else. Both sides
// are mocked: stremio.ts's and aiostreams.ts's own calls, and remote.ts.
const stremio = vi.hoisted(() => ({
  fetchManifest: vi.fn(async () => ({ id: "m", name: "M", resources: [], catalogs: [] })),
  fetchCatalog: vi.fn(async () => ({ metas: [] })),
  fetchMeta: vi.fn(async () => ({})),
  fetchStreams: vi.fn(async () => ({ streams: [] })),
}));
vi.mock("./stremio", async (orig) => ({ ...(await orig<typeof import("./stremio")>()), ...stremio }));
const listed = vi.hoisted(() => vi.fn(async () => [{ key: "movie/top", type: "movie", name: "Top" }]));
vi.mock("./aiostreams", async (orig) => ({ ...(await orig<typeof import("./aiostreams")>()), fetchAioCatalogs: listed }));
const remote = vi.hoisted(() => ({
  remoteManifest: vi.fn(async () => ({
    id: "r",
    name: "R",
    resources: [],
    catalogs: [
      { type: "movie", id: "top", name: "Top Movies", extra: [{ name: "skip" }] },
      { type: "movie", id: "aiojf.search.movie", name: "Search movies", extra: [{ name: "search", isRequired: true }] },
    ],
  })),
  remoteCatalog: vi.fn(async () => ({ metas: [] })),
  remoteMeta: vi.fn(async () => ({})),
  remoteStreams: vi.fn(async () => ({ streams: [] })),
}));
vi.mock("../features/aiojf/remote", () => remote);

import { aioCatalog, aioCatalogDefs, aioManifest, aioMeta, aioStreams } from "./aio";

const MANIFEST_URL = "https://aio.example.com/stremio/u/p/manifest.json";
const manifest: AioConn = { kind: "manifest", url: MANIFEST_URL, key: "manifest:x" };
const signin: AioConn = { kind: "signin", base: "https://aio.example.com/jellyfin", key: "signin:x|" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a manifest connection", () => {
  it("reads the manifest URL through stremio.ts, and never the sign-in", async () => {
    await aioManifest(manifest);
    await aioCatalog(manifest, "movie", "top", "skip=40", 100);
    await aioMeta(manifest, "movie", "tt1", { episodes: false });
    await aioStreams(manifest, "series", "tt1:1:1", { refresh: true });
    expect(stremio.fetchManifest).toHaveBeenCalledWith(MANIFEST_URL);
    // The limit is the sign-in's: the manifest's addon sends the page it sends.
    expect(stremio.fetchCatalog).toHaveBeenCalledWith(MANIFEST_URL, "movie", "top", "skip=40");
    expect(stremio.fetchMeta).toHaveBeenCalledWith(MANIFEST_URL, "movie", "tt1");
    // And so is the refresh: the addon searches on every ask.
    expect(stremio.fetchStreams).toHaveBeenCalledWith(MANIFEST_URL, "series", "tt1:1:1");
    for (const f of Object.values(remote)) expect(f).not.toHaveBeenCalled();
  });

  it("lists the hero picker's catalogs from the manifest URL", async () => {
    expect(await aioCatalogDefs(manifest)).toEqual([{ key: "movie/top", type: "movie", name: "Top" }]);
    expect(listed).toHaveBeenCalledWith(MANIFEST_URL);
    expect(remote.remoteManifest).not.toHaveBeenCalled();
  });
});

describe("a sign-in connection", () => {
  it("reads the Jellyfin side through remote.ts, and never the manifest's calls", async () => {
    await aioManifest(signin);
    await aioCatalog(signin, "movie", "top", "skip=40", 100);
    await aioMeta(signin, "movie", "tt1", { episodes: false });
    await aioStreams(signin, "series", "tt1:1:1", { refresh: true });
    expect(remote.remoteManifest).toHaveBeenCalledWith(signin);
    expect(remote.remoteCatalog).toHaveBeenCalledWith(signin, "movie", "top", "skip=40", 100);
    expect(remote.remoteMeta).toHaveBeenCalledWith(signin, "movie", "tt1", { episodes: false });
    expect(remote.remoteStreams).toHaveBeenCalledWith(signin, "series", "tt1:1:1", { refresh: true });
    for (const f of Object.values(stremio)) expect(f).not.toHaveBeenCalled();
  });

  it("lists the hero picker's catalogs from the views, with no search catalog among them", async () => {
    expect(await aioCatalogDefs(signin)).toEqual([{ key: "movie/top", type: "movie", name: "Top Movies" }]);
    expect(listed).not.toHaveBeenCalled();
  });
});
