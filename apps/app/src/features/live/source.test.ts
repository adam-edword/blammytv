import { describe, expect, it } from "vitest";
import type { XtreamPlaylist } from "../settings/playlists";
import { epgIndex, mapStreams } from "./source";

const playlist = (over: Partial<XtreamPlaylist> = {}): XtreamPlaylist => ({
  kind: "xtream",
  id: "pl1",
  name: "Meteor",
  enabled: true,
  server: "http://tv.example.com:8080",
  username: "u",
  password: "p",
  ...over,
});

describe("mapStreams", () => {
  it("normalizes panel streams into namespaced channels", () => {
    const [ch] = mapStreams(
      [
        {
          stream_id: 42,
          name: "ESPN 4K",
          stream_icon: "http://cdn.example.com/espn.png",
          category_id: "7",
        },
      ],
      playlist(),
    );
    expect(ch).toEqual({
      id: "pl1:42",
      name: "ESPN 4K",
      quality: "4K",
      folderId: "pl1:7",
      logo: "http://cdn.example.com/espn.png",
    });
  });

  it("drops streams in hidden categories entirely", () => {
    const chans = mapStreams(
      [
        { stream_id: 1, name: "Keep", category_id: "7" },
        { stream_id: 2, name: "Hide", category_id: "13" },
      ],
      playlist({ hiddenCategories: ["13"] }),
    );
    expect(chans.map((c) => c.name)).toEqual(["Keep"]);
  });

  it("survives sloppy panel data", () => {
    const chans = mapStreams(
      [
        // Blank name, junk icon, no category.
        { stream_id: 9, name: "  ", stream_icon: "not a url" },
        { stream_id: 10, name: "Plain SD Channel", stream_icon: null },
      ],
      playlist(),
    );
    expect(chans[0]).toEqual({
      id: "pl1:9",
      name: "Channel 9",
      quality: null,
      folderId: "pl1:",
      logo: undefined,
    });
    expect(chans[1].quality).toBeNull();
    expect(chans[1].logo).toBeUndefined();
  });
});

describe("epgIndex", () => {
  it("maps one EPG feed to every channel that uses it", () => {
    const idx = epgIndex(
      [
        { stream_id: 1, epg_channel_id: "espn.us", category_id: "7" },
        { stream_id: 2, epg_channel_id: "espn.us", category_id: "8" },
        { stream_id: 3, epg_channel_id: null, category_id: "7" },
      ],
      playlist(),
    );
    expect(idx.get("espn.us")).toEqual(["pl1:1", "pl1:2"]);
    expect(idx.size).toBe(1);
  });

  it("skips hidden categories", () => {
    const idx = epgIndex(
      [{ stream_id: 1, epg_channel_id: "espn.us", category_id: "13" }],
      playlist({ hiddenCategories: ["13"] }),
    );
    expect(idx.size).toBe(0);
  });
});
