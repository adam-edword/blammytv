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
const jf = vi.hoisted(() => ({
  key: "",
  resolveJfItem: vi.fn(async () => ({ id: "tt1", from: "jf" })),
  resolveJfList: vi.fn(async () => ({ sources: [], notices: ["from jellyfin"] })),
}));
vi.mock("../jellyfin/vod", () => ({
  jfVodKey: () => jf.key,
  resolveJfItem: jf.resolveJfItem,
  resolveJfList: jf.resolveJfList,
}));

const xt = vi.hoisted(() => ({
  key: "",
  resolveXtItem: vi.fn(async () => ({ id: "xt:p:m:t1", from: "xt" })),
  resolveXtList: vi.fn(async () => ({ sources: [], notices: ["from a playlist"] })),
}));
vi.mock("../xtvod/vod", () => ({
  xtVodKey: () => xt.key,
  resolveXtItem: xt.resolveXtItem,
  resolveXtList: xt.resolveXtList,
}));

import { configKey, resolveVodItem, resolveVodList, resolveVodSources } from "./source";

const manifest: AioConn = { kind: "manifest", url: "https://aio.example.com/m/manifest.json", key: "manifest:https://aio.example.com/m/manifest.json" };
const signin: AioConn = { kind: "signin", base: "https://aio.example.com/jellyfin", key: "signin:https://aio.example.com/jellyfin|Adam" };

beforeEach(() => {
  vi.clearAllMocks();
  conn = signin;
  jf.key = "";
  xt.key = "";
});

describe("an item from your Jellyfin", () => {
  it("is asked of the server alone: its files, whatever the addon is signed in as", async () => {
    for (const c of [signin, null]) {
      conn = c;
      const l = await resolveVodList("movie", "tt1", { from: "jf" });
      expect(l.notices).toEqual(["from jellyfin"]);
      expect((await resolveVodSources("series", "tt1:1:2", { from: "jf" }))).toEqual([]);
    }
    expect(aio.aioStreams).not.toHaveBeenCalled();
    expect(jf.resolveJfList).toHaveBeenCalledWith("series", "tt1:1:2");
  });

  it("has its detail from the server, and the addon is not asked", async () => {
    const v = await resolveVodItem("movie", "tt1", "jf");
    expect(v).toMatchObject({ id: "tt1", from: "jf" });
    expect(aio.aioMeta).not.toHaveBeenCalled();
  });

  it("an item with no origin is still the addon's", async () => {
    await resolveVodSources("movie", "tt1");
    expect(jf.resolveJfList).not.toHaveBeenCalled();
    expect(aio.aioStreams).toHaveBeenCalled();
  });

  it("moves the screen's key when a server comes or goes, and leaves the addon's own key alone", () => {
    const without = configKey();
    jf.key = '["jf:https://jf.example.com|u1",40]';
    const withJf = configKey();
    expect(withJf).not.toBe(without);
    jf.key = "";
    expect(configKey()).toBe(without);
  });
});

describe("an item from an Xtream playlist", () => {
  it("is asked of its panel alone: its files, whatever the addon is signed in as", async () => {
    for (const c of [signin, null]) {
      conn = c;
      const l = await resolveVodList("movie", "xt:p:m:t1", { from: "xt" });
      expect(l.notices).toEqual(["from a playlist"]);
      expect(await resolveVodSources("series", "xt:p:s:t1:1:2", { from: "xt" })).toEqual([]);
    }
    expect(aio.aioStreams).not.toHaveBeenCalled();
    expect(jf.resolveJfList).not.toHaveBeenCalled();
    expect(xt.resolveXtList).toHaveBeenCalledWith("series", "xt:p:s:t1:1:2");
  });

  it("has its detail from its panel, and neither the addon nor a Jellyfin is asked", async () => {
    expect(await resolveVodItem("movie", "xt:p:m:t1", "xt")).toMatchObject({ id: "xt:p:m:t1", from: "xt" });
    expect(aio.aioMeta).not.toHaveBeenCalled();
    expect(jf.resolveJfItem).not.toHaveBeenCalled();
  });

  it("moves the screen's key when a library comes or goes, and leaves the other keys alone", () => {
    const without = configKey();
    jf.key = '["jf:https://jf.example.com|u1",40]';
    const withJf = configKey();
    jf.key = "";
    xt.key = '[[["p","Test","1s37rfe",[],[]]],40,false]';
    const withXt = configKey();
    expect(withXt).not.toBe(without);
    jf.key = '["jf:https://jf.example.com|u1",40]';
    expect(configKey()).not.toBe(withXt);
    // A Jellyfin alone is the key it was before a library existed.
    xt.key = "";
    expect(configKey()).toBe(withJf);
    jf.key = "";
    expect(configKey()).toBe(without);
  });
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

describe("resolveVodList", () => {
  const notice = { name: "Torbox", description: "Rate limit exceeded", streamData: { type: "error" } };

  it("answers what AIOStreams said beside the sources, which stay what they were", async () => {
    aio.aioStreams.mockResolvedValueOnce({
      streams: [{ name: "1080p", url: "https://cdn.example.com/v.mp4" }, notice] as never,
    });
    const l = await resolveVodList("movie", "tt1");
    expect(l.sources.map((s) => s.streamUrl)).toEqual(["https://cdn.example.com/v.mp4"]);
    expect(l.notices).toEqual(["Torbox: Rate limit exceeded"]);
  });

  it("is the notices alone for a title nothing plays, which resolveVodSources shows as empty", async () => {
    aio.aioStreams.mockResolvedValueOnce({ streams: [notice] as never });
    aio.aioStreams.mockResolvedValueOnce({ streams: [notice] as never });
    expect((await resolveVodList("movie", "tt1")).notices).toEqual(["Torbox: Rate limit exceeded"]);
    expect(await resolveVodSources("movie", "tt1")).toEqual([]);
  });

  it("asks nothing with no connection", async () => {
    conn = null;
    expect(await resolveVodList("movie", "tt1")).toEqual({ sources: [], notices: [] });
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
