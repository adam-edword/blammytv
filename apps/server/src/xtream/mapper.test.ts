import { describe, it, expect } from "vitest";
import { mapGroups, mapChannels, mapEpg } from "./mapper.js";
import type { XtreamCategory, XtreamLiveStream } from "./types.js";
import type { XtreamClient } from "./client.js";

const client = {
  liveStreamUrl: (id: number | string) => `http://host/live/${id}.ts`,
} as XtreamClient;

describe("mapGroups", () => {
  it("namespaces ids by source and preserves order", () => {
    const cats: XtreamCategory[] = [
      { category_id: "10", category_name: "Sports" },
      { category_id: "20", category_name: "News" },
    ];
    const groups = mapGroups(cats, "src1");
    expect(groups).toEqual([
      { id: "src1:g:10", name: "Sports", hidden: false, order: 0 },
      { id: "src1:g:20", name: "News", hidden: false, order: 1 },
    ]);
  });
});

describe("mapChannels", () => {
  const streams: XtreamLiveStream[] = [
    {
      name: "Sky Sports",
      stream_id: 101,
      stream_icon: "https://cdn/logo.png",
      category_id: "10",
      epg_channel_id: "sky.uk",
    },
    {
      name: "No Logo TV",
      stream_id: "202",
      stream_icon: "not-a-url",
      epg_channel_id: "",
    },
  ];

  it("builds namespaced channels with resolved stream URLs", () => {
    const [a, b] = mapChannels(streams, "src1", client);
    expect(a).toEqual({
      id: "src1:c:101",
      name: "Sky Sports",
      logo: "https://cdn/logo.png",
      groupId: "src1:g:10",
      streamUrl: "http://host/live/101.ts",
      epgId: "sky.uk",
    });
    // Invalid logo URL is dropped; empty epg id becomes undefined; missing
    // category maps to the empty-category group id.
    expect(b.logo).toBeUndefined();
    expect(b.epgId).toBeUndefined();
    expect(b.groupId).toBe("src1:g:");
    expect(b.streamUrl).toBe("http://host/live/202.ts");
  });
});

describe("mapEpg", () => {
  const channels = mapChannels(
    [{ name: "Sky", stream_id: 1, epg_channel_id: "sky.uk" }],
    "src1",
    client,
  );
  const now = Date.UTC(2026, 5, 16, 20, 0, 0);
  const xmltv = (start: string, stop: string, channel = "sky.uk") =>
    `<?xml version="1.0"?><tv><programme channel="${channel}" start="${start}" stop="${stop}"><title>Match</title><desc>A game</desc></programme></tv>`;

  it("matches programmes to channels by epg id, within the window", () => {
    const progs = mapEpg(
      xmltv("20260616201500 +0000", "20260616214500 +0000"),
      channels,
      now,
    );
    expect(progs).toHaveLength(1);
    expect(progs[0]).toMatchObject({
      channelId: "src1:c:1",
      title: "Match",
      description: "A game",
      start: "2026-06-16T20:15:00.000Z",
      stop: "2026-06-16T21:45:00.000Z",
    });
  });

  it("drops programmes outside the [-1h, +12h] window", () => {
    // Two days ahead — beyond the +12h horizon.
    const progs = mapEpg(
      xmltv("20260618200000 +0000", "20260618210000 +0000"),
      channels,
      now,
    );
    expect(progs).toEqual([]);
  });

  it("ignores programmes whose channel has no matching epg id", () => {
    const progs = mapEpg(
      xmltv("20260616201500 +0000", "20260616214500 +0000", "other.uk"),
      channels,
      now,
    );
    expect(progs).toEqual([]);
  });

  it("returns [] for unparseable XML", () => {
    expect(mapEpg("not xml <<<", channels, now)).toEqual([]);
  });
});
