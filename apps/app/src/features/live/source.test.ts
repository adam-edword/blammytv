import { describe, expect, it } from "vitest";
import type { XtreamPlaylist } from "../settings/playlists";
import {
  archiveDaysOf,
  channelNumber,
  droppedCategories,
  epgIndex,
  mapStreams,
} from "./source";

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
      archiveDays: 0,
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
      archiveDays: 0,
    });
    expect(chans[1].quality).toBeNull();
    expect(chans[1].logo).toBeUndefined();
  });

  it("carries catch-up depth from the panel's archive fields", () => {
    const [ch] = mapStreams(
      [
        {
          stream_id: 1,
          name: "BBC One FHD",
          category_id: "248",
          // String-typed, exactly as the real panel sends them.
          tv_archive: 1,
          tv_archive_duration: "3",
        },
      ],
      playlist(),
    );
    expect(ch.archiveDays).toBe(3);
  });
});

describe("channelNumber", () => {
  it("coerces the panel's num field to a positive integer", () => {
    expect(channelNumber({ stream_id: 1, num: 101 })).toBe(101);
    expect(channelNumber({ stream_id: 1, num: "205" })).toBe(205);
    expect(channelNumber({ stream_id: 1, num: "12.0" })).toBe(12);
  });

  it("is undefined when the panel gives no usable number", () => {
    expect(channelNumber({ stream_id: 1 })).toBeUndefined();
    expect(channelNumber({ stream_id: 1, num: 0 })).toBeUndefined();
    expect(channelNumber({ stream_id: 1, num: "" })).toBeUndefined();
    expect(channelNumber({ stream_id: 1, num: null })).toBeUndefined();
    expect(channelNumber({ stream_id: 1, num: "abc" })).toBeUndefined();
  });

  it("mapStreams carries the number onto the channel", () => {
    const [ch] = mapStreams(
      [{ stream_id: 7, name: "ESPN", category_id: "1", num: "104" }],
      playlist(),
    );
    expect(ch.number).toBe(104);
  });
});

describe("archiveDaysOf", () => {
  it("coerces the panel's string fields to a positive day count", () => {
    expect(archiveDaysOf({ stream_id: 1, tv_archive: 1, tv_archive_duration: "3" })).toBe(3);
    expect(archiveDaysOf({ stream_id: 1, tv_archive: "1", tv_archive_duration: "1" })).toBe(1);
  });

  it("is 0 when the channel has no usable archive", () => {
    // Not flagged.
    expect(archiveDaysOf({ stream_id: 1, tv_archive: 0, tv_archive_duration: "3" })).toBe(0);
    // Flagged but a junk / zero / missing duration.
    expect(archiveDaysOf({ stream_id: 1, tv_archive: 1, tv_archive_duration: "0" })).toBe(0);
    expect(archiveDaysOf({ stream_id: 1, tv_archive: 1, tv_archive_duration: "" })).toBe(0);
    expect(archiveDaysOf({ stream_id: 1, tv_archive: 1 })).toBe(0);
    expect(archiveDaysOf({ stream_id: 1 })).toBe(0);
  });
});

describe("adult filter", () => {
  const cats = [
    { id: "1", name: "Sports", adult: false },
    { id: "2", name: "XXX VIP", adult: false }, // caught by name
    { id: "3", name: "After Dark", adult: true }, // caught by panel flag
    { id: "4", name: "Adult Swim", adult: false }, // the exception — stays
  ];

  it("droppedCategories merges user-hidden with adult when filtering", () => {
    const hidden = droppedCategories(
      playlist({ hiddenCategories: ["1"] }),
      cats,
      false,
    );
    expect([...hidden].sort()).toEqual(["1", "2", "3"]);
  });

  it("droppedCategories leaves adult folders alone when showing", () => {
    const hidden = droppedCategories(
      playlist({ hiddenCategories: ["1"] }),
      cats,
      true,
    );
    expect([...hidden]).toEqual(["1"]);
  });

  it("mapStreams drops adult-flagged streams by default", () => {
    const chans = mapStreams(
      [
        { stream_id: 1, name: "Keep", category_id: "7" },
        { stream_id: 2, name: "Drop", category_id: "7", is_adult: "1" },
      ],
      playlist(),
    );
    expect(chans.map((c) => c.name)).toEqual(["Keep"]);
  });

  it("mapStreams keeps adult streams when the filter is off", () => {
    const chans = mapStreams(
      [{ stream_id: 2, name: "Kept", category_id: "7", is_adult: 1 }],
      playlist(),
      new Set(),
      false,
    );
    expect(chans.map((c) => c.name)).toEqual(["Kept"]);
  });

  it("epgIndex skips adult streams by default", () => {
    const idx = epgIndex(
      [{ stream_id: 1, epg_channel_id: "x.tv", category_id: "7", is_adult: "1" }],
      playlist(),
    );
    expect(idx.size).toBe(0);
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
