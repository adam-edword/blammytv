import { describe, expect, it } from "vitest";
import { parseM3u } from "./parser";

describe("parseM3u", () => {
  it("parses attributes, display name, and the following URL", () => {
    const { entries } = parseM3u(
      `#EXTM3U
#EXTINF:-1 tvg-id="BBC1.uk" tvg-logo="http://logo/bbc.png" group-title="UK",BBC One HD
http://server/live/1`,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      name: "BBC One HD",
      url: "http://server/live/1",
      logo: "http://logo/bbc.png",
      groupTitle: "UK",
      tvgId: "BBC1.uk",
    });
  });

  it("reads the EPG url from the #EXTM3U header (first of several)", () => {
    const { epgUrl } = parseM3u(
      `#EXTM3U url-tvg="http://epg/a.xml,http://epg/b.xml" x-tvg-url="http://epg/c.xml"`,
    );
    expect(epgUrl).toBe("http://epg/a.xml");
  });

  it("falls back to x-tvg-url when url-tvg is absent", () => {
    const { epgUrl } = parseM3u(`#EXTM3U x-tvg-url="http://epg/c.xml"`);
    expect(epgUrl).toBe("http://epg/c.xml");
  });

  it("honours #EXTGRP grouping and skips unknown directives", () => {
    const { entries } = parseM3u(
      `#EXTINF:-1,Channel 2
#EXTGRP:Sports
#EXTVLCOPT:http-user-agent=Foo
http://server/live/2`,
    );
    expect(entries[0].groupTitle).toBe("Sports");
    expect(entries[0].url).toBe("http://server/live/2");
  });

  it("drops entries whose line isn't an http(s) URL", () => {
    const { entries } = parseM3u(
      `#EXTINF:-1,Bad
rtmp://server/nope
#EXTINF:-1,Good
https://server/yes`,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Good");
  });

  it("falls back to tvg-name when there's no display label", () => {
    const { entries } = parseM3u(
      `#EXTINF:-1 tvg-name="Fallback",
http://server/live/3`,
    );
    expect(entries[0].name).toBe("Fallback");
  });
});
