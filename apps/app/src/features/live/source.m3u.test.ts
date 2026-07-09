import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real M3U branch of loadLive end-to-end: a saved M3U playlist
// + a mocked httpGetText serving the playlist text (and an empty EPG), with
// disk/adult stubbed out. Asserts the parse → group → channel mapping and
// the adult-group drop.

const httpGetText = vi.fn();
vi.mock("../../lib/http", () => ({
  httpGetText: (...a: unknown[]) => httpGetText(...a),
  httpGetJson: vi.fn(),
}));
vi.mock("./diskCache", () => ({
  diskGet: vi.fn().mockResolvedValue(null),
  diskPut: vi.fn().mockResolvedValue(undefined),
}));
let showAdult = false;
vi.mock("../settings/adultFilter", () => ({
  loadShowAdult: () => showAdult,
}));
vi.mock("../settings/playlists", () => ({
  loadPlaylists: () => [
    {
      kind: "m3u",
      id: "m1",
      name: "My M3U",
      enabled: true,
      url: "http://host/playlist.m3u",
    },
  ],
}));

const PLAYLIST = [
  "#EXTM3U",
  '#EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://host/bbc1.png" group-title="UK" tvg-chno="101",BBC One',
  "http://host/live/1.ts",
  '#EXTINF:-1 group-title="UK",ITV',
  "http://host/live/2.ts",
  '#EXTINF:-1 group-title="XXX Adult",Naughty Channel',
  "http://host/live/3.ts",
].join("\n");

describe("loadLive M3U path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    showAdult = false;
    httpGetText.mockImplementation((url: string) =>
      url.endsWith(".m3u")
        ? Promise.resolve(PLAYLIST)
        : Promise.reject(new Error("no epg")),
    );
  });

  it("parses channels, groups, number, and drops the adult group", async () => {
    const { loadLive } = await import("./source");
    const data = await loadLive(new Date());
    // The adult group ("XXX Adult") is dropped by name; two channels remain.
    expect(data.channels.map((c) => c.name)).toEqual(["BBC One", "ITV"]);
    expect(data.channels[0].number).toBe(101);
    expect(data.channels[0].id).toBe("m1:bbc1.uk"); // tvg-id → stable id
    const folders = data.groups[0].folders.map((f) => f.name);
    expect(folders).toEqual(["UK"]);
    expect(folders).not.toContain("XXX Adult");
  });

  it("keeps the adult group when the filter is off", async () => {
    showAdult = true;
    const { loadLive } = await import("./source");
    const data = await loadLive(new Date());
    expect(data.channels.map((c) => c.name)).toContain("Naughty Channel");
    expect(data.groups[0].folders.map((f) => f.name)).toContain("XXX Adult");
  });
});
