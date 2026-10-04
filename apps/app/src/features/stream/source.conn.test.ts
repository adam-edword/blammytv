import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AioConn } from "../aiojf/conn";

// Which connection Stream reads, and what it passes on: the sign-in's fresh
// sources (plan 024, D3) and the cache key a sign-in changes.

let conn: AioConn | null = null;
vi.mock("../aiojf/conn", () => ({ loadAioConn: () => conn }));
vi.mock("../settings/aiostreams", () => ({ loadHeroSources: () => [] }));
const aio = vi.hoisted(() => ({
  aioStreams: vi.fn(async () => ({ streams: [{ name: "1080p", url: "https://cdn.example.com/v.mp4" }] })),
  aioMeta: vi.fn(async () => ({})),
  aioManifest: vi.fn(),
  aioCatalog: vi.fn(),
}));
vi.mock("../../data/aio", () => aio);

import { configKey, resolveVodSources } from "./source";

const manifest: AioConn = { kind: "manifest", url: "https://aio.example.com/m/manifest.json", key: "manifest:https://aio.example.com/m/manifest.json" };
const signin: AioConn = { kind: "signin", base: "https://aio.example.com/jellyfin", key: "signin:https://aio.example.com/jellyfin|Adam" };

beforeEach(() => {
  vi.clearAllMocks();
  conn = signin;
});

describe("resolveVodSources", () => {
  it("a plain open does not ask to refresh", async () => {
    await resolveVodSources("movie", "tt1");
    expect(aio.aioStreams).toHaveBeenCalledWith(signin, "movie", "tt1", {});
  });

  it("Retry's refresh is passed on, for an episode as well", async () => {
    await resolveVodSources("series", "tt1:1:2", { refresh: true });
    expect(aio.aioStreams).toHaveBeenCalledWith(signin, "series", "tt1:1:2", { refresh: true });
  });

  it("answers the sources the player takes", async () => {
    const list = await resolveVodSources("movie", "tt1");
    expect(list.map((s) => s.streamUrl)).toEqual(["https://cdn.example.com/v.mp4"]);
  });

  it("asks nothing with no connection", async () => {
    conn = null;
    expect(await resolveVodSources("movie", "tt1")).toEqual([]);
    expect(aio.aioStreams).not.toHaveBeenCalled();
  });
});

describe("configKey", () => {
  it("is another key under a sign-in than under the manifest, so a built page is not shared", () => {
    conn = manifest;
    const a = configKey();
    conn = signin;
    const b = configKey();
    expect(a).not.toBe(b);
    expect(b).toContain(signin.key);
  });

  it("is the same with no connection as with an empty one, and moves with a user", () => {
    conn = null;
    expect(configKey()).toBe(JSON.stringify(["", [], 40]));
    conn = signin;
    const a = configKey();
    conn = { ...signin, key: "signin:https://aio.example.com/jellyfin|Eve" };
    expect(configKey()).not.toBe(a);
  });
});
