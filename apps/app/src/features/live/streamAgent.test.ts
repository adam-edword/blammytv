import { describe, expect, it, vi } from "vitest";

// The playlists streamUserAgent looks a channel's playlist up in.
const LISTS = [
  { kind: "xtream", id: "pl1", name: "With", enabled: true, server: "http://s", username: "u", password: "p", userAgent: "  TestApp/9.1  " },
  { kind: "m3u", id: "pl2", name: "Without", enabled: true, url: "http://m/p.m3u" },
  { kind: "stalker", id: "pl3", name: "Bad", enabled: true, portal: "http://p", mac: "00:1A:79:AA:BB:CC", userAgent: "bad\r\nX-Evil: 1" },
];
vi.mock("../settings/playlists", () => ({ loadPlaylists: () => LISTS }));

const { streamUserAgent } = await import("./stream");

describe("streamUserAgent", () => {
  it("is the agent of the playlist the channel id names, trimmed", () => {
    expect(streamUserAgent("pl1:101")).toBe("TestApp/9.1");
    // An M3U channel's id carries a tvg-id or a hash after the playlist's.
    expect(streamUserAgent("pl1:some:thing~2")).toBe("TestApp/9.1");
  });

  it("is none for a playlist without one, and for one whose saved agent is not usable", () => {
    expect(streamUserAgent("pl2:abc")).toBeUndefined();
    expect(streamUserAgent("pl3:101")).toBeUndefined();
  });

  it("is none for an id that names no playlist: a mock channel, a playlist since removed", () => {
    expect(streamUserAgent("ch0")).toBeUndefined();
    expect(streamUserAgent("gone:101")).toBeUndefined();
    expect(streamUserAgent("")).toBeUndefined();
  });
});
