import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const put = (key: string, data: unknown) => localStorage.setItem(`blammytv.${key}`, JSON.stringify({ v: 1, data }));

describe("a stored list that isn't one", () => {
  beforeEach(() => localStorage.clear());

  it("reads as empty rather than taking the app down at boot", async () => {
    const { loadPlaylists } = await import("../features/settings/playlists");
    const { loadFavorites } = await import("../features/live/favorites");
    const { loadRecents } = await import("../features/live/recents");
    const { loadWatching } = await import("../features/stream/watching");
    const { loadAioUrl, loadHeroSources } = await import("../features/settings/aiostreams");
    for (const key of ["playlists", "favorites", "recents", "watching", "heroSources"]) put(key, { not: "a list" });
    put("aiostreams", 42);
    expect(loadPlaylists()).toEqual([]);
    expect(loadFavorites()).toEqual([]);
    expect(loadRecents()).toEqual([]);
    expect(loadWatching()).toEqual([]);
    expect(loadHeroSources()).toEqual([]);
    expect(loadAioUrl()).toBe("");
  });

  it("keeps the good items of a list and drops the rest", async () => {
    const { loadPlaylists } = await import("../features/settings/playlists");
    const { loadFavorites } = await import("../features/live/favorites");
    const good = { kind: "m3u", id: "m", name: "M", enabled: true, url: "http://x/p.m3u" };
    put("playlists", [good, null, { kind: "nope", id: "x" }, "junk"]);
    put("favorites", ["t:1", 7, null, "t:2"]);
    expect(loadPlaylists()).toEqual([good]);
    expect(loadFavorites()).toEqual(["t:1", "t:2"]);
  });
});
