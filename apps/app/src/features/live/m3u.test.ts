import { describe, expect, it } from "vitest";
import { parseM3U } from "./m3u";

describe("parseM3U", () => {
  it("parses a normal multi-channel playlist with all attributes", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-id="espn.us" tvg-name="ESPN" tvg-logo="http://cdn.example/espn.png" group-title="Sports" tvg-chno="5",ESPN HD
http://host.example/live/espn.m3u8
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://cdn.example/bbc1.png" group-title="UK",BBC One
http://host.example/live/bbc1.ts`,
    );
    expect(out).toEqual([
      {
        url: "http://host.example/live/espn.m3u8",
        name: "ESPN HD",
        logo: "http://cdn.example/espn.png",
        groupTitle: "Sports",
        tvgId: "espn.us",
        tvgName: "ESPN",
        channelNumber: 5,
      },
      {
        url: "http://host.example/live/bbc1.ts",
        name: "BBC One",
        logo: "http://cdn.example/bbc1.png",
        groupTitle: "UK",
        tvgId: "bbc1.uk",
        tvgName: "BBC One",
      },
    ]);
  });

  it("takes group-title over a preceding #EXTGRP, and uses #EXTGRP otherwise", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTGRP:Documentaries
#EXTINF:-1,Nature One
http://host.example/n1.ts
#EXTINF:-1 group-title="Movies",Film Two
http://host.example/f2.ts`,
    );
    // #EXTGRP supplies the group when the EXTINF has none…
    expect(out[0].groupTitle).toBe("Documentaries");
    // …but an explicit group-title wins.
    expect(out[1].groupTitle).toBe("Movies");
  });

  it("#EXTGRP applies to the next entry only", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTGRP:News
#EXTINF:-1,First
http://host.example/1.ts
#EXTINF:-1,Second
http://host.example/2.ts`,
    );
    expect(out[0].groupTitle).toBe("News");
    // The group is consumed by the first entry; the second has none.
    expect(out[1].groupTitle).toBeUndefined();
  });

  it("takes the display name from the last unquoted comma, skipping quoted commas", () => {
    const out = parseM3U(
      `#EXTINF:-1 tvg-name="News, Weather & Sport" group-title="UK, Ireland",BBC One London
http://host.example/bbc1.m3u8`,
    );
    // Commas inside quoted attribute values are skipped, so the split lands on
    // the real separator before the display name — attrs keep their commas.
    expect(out[0].name).toBe("BBC One London");
    expect(out[0].groupTitle).toBe("UK, Ireland");
    expect(out[0].tvgName).toBe("News, Weather & Sport");
  });

  it("splits at the LAST unquoted comma when the name itself contains one", () => {
    // The rule is unquoted-comma based, so a display name with an internal
    // comma is split at its last comma — the documented tradeoff that keeps
    // the parser robust against unquoted commas in the attribute region.
    const out = parseM3U(
      `#EXTINF:-1 group-title="News",Al Jazeera, Arabic
http://host.example/aj.ts`,
    );
    expect(out[0].groupTitle).toBe("News");
    expect(out[0].name).toBe("Arabic");
  });

  it("tolerates a missing #EXTM3U header", () => {
    const out = parseM3U(
      `#EXTINF:-1 tvg-id="a.b" group-title="News",Channel A
http://host.example/a.ts`,
    );
    expect(out).toEqual([
      {
        url: "http://host.example/a.ts",
        name: "Channel A",
        groupTitle: "News",
        tvgId: "a.b",
      },
    ]);
  });

  it("handles an EXTINF with no attributes (just #EXTINF:-1,Name)", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTINF:-1,Bare Channel
http://host.example/bare.ts`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Bare Channel");
    expect(out[0].groupTitle).toBeUndefined();
    expect(out[0].logo).toBeUndefined();
    expect(out[0].tvgId).toBeUndefined();
    expect(out[0].channelNumber).toBeUndefined();
  });

  it("tolerates CRLF line endings", () => {
    const out = parseM3U(
      '#EXTM3U\r\n#EXTINF:-1 tvg-id="a.b" group-title="News",Channel A\r\nhttp://host.example/a.ts\r\n',
    );
    expect(out).toEqual([
      {
        url: "http://host.example/a.ts",
        name: "Channel A",
        groupTitle: "News",
        tvgId: "a.b",
      },
    ]);
  });

  it("drops an EXTINF with no following URL line", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTINF:-1,Orphan With No URL
#EXTINF:-1,Has A URL
http://host.example/kept.ts`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Has A URL");
    expect(out[0].url).toBe("http://host.example/kept.ts");
  });

  it("skips blank lines and unknown #EXT directives without losing the entry", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTINF:-1,Wrapped Channel
#EXTVLCOPT:http-user-agent=Foo/1.0

http://host.example/wrapped.ts`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("http://host.example/wrapped.ts");
    expect(out[0].name).toBe("Wrapped Channel");
  });

  it("reads channel numbers from tvg-chno or channel-number, omitting them otherwise", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-chno="12",Chno Channel
http://host.example/1.ts
#EXTINF:-1 channel-number="7",Numbered Channel
http://host.example/2.ts
#EXTINF:-1,No Number
http://host.example/3.ts
#EXTINF:-1 tvg-chno="not-a-number",Junk Number
http://host.example/4.ts
#EXTINF:-1 tvg-chno="",Empty Number
http://host.example/5.ts
#EXTINF:-1 tvg-chno="-3",Negative Number
http://host.example/6.ts
#EXTINF:-1 tvg-chno="0",Zero Number
http://host.example/7.ts`,
    );
    expect(out[0].channelNumber).toBe(12);
    expect(out[1].channelNumber).toBe(7);
    expect(out[2].channelNumber).toBeUndefined();
    // A non-numeric channel number is dropped rather than surfaced as NaN.
    expect(out[3].channelNumber).toBeUndefined();
    // tvg-chno="" would coerce to 0 via Number("") — dropped, not chip "#0".
    expect(out[4].channelNumber).toBeUndefined();
    // Junk negatives and zero are dropped too: positive integers only.
    expect(out[5].channelNumber).toBeUndefined();
    expect(out[6].channelNumber).toBeUndefined();
  });

  it("falls back to tvg-name then the URL when the display name is empty", () => {
    const out = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-name="Fallback Name",
http://host.example/named.ts
#EXTINF:-1,
http://host.example/nameless.ts`,
    );
    expect(out[0].name).toBe("Fallback Name");
    expect(out[1].name).toBe("http://host.example/nameless.ts");
  });

  it("returns [] for empty or total-garbage input", () => {
    for (const text of [
      "",
      "\n\n",
      "hello\nworld",
      "http://orphan.example/u.ts",
      "#EXTM3U\n#EXTGRP:News\n# just a comment",
    ]) {
      expect(parseM3U(text), JSON.stringify(text)).toEqual([]);
    }
  });
});
