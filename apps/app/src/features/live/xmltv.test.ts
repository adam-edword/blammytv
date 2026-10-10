import { describe, expect, it } from "vitest";
import { isFillerTitle, parseGuide, parseXmltv, parseXmltvTime, readGuideChannels, type XmltvStats } from "./xmltv";
import { parseXmltvOffThread } from "./xmltvThread";

// The full parse is tested here since v0.10.11: it reads the text itself
// rather than asking the WebView's DOMParser, which node does not have.

const NOW = new Date("2026-09-26T20:00:00Z");
const at = (h: number, m = 0) => {
  const d = new Date(NOW.getTime() + h * 3600_000 + m * 60_000);
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
};
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="x">${body}</tv>`;
const ids = (pairs: Record<string, string[]>) => new Map(Object.entries(pairs));
const titles = (out: ReturnType<typeof parseXmltv>, ch: string) => (out.get(ch) ?? []).map((p) => p.title);

describe("parseXmltv", () => {
  it("reads each programme's channel, times, first title and description", () => {
    const out = parseXmltv(
      doc(
        `<channel id="espn.us"><display-name>ESPN</display-name></channel>` +
          `<programme start="${at(0)}" stop="${at(1)}" channel="espn.us">` +
          `<title lang="en">SportsCenter</title><title lang="es">Centro</title>` +
          `<desc lang="en">Highlights.</desc><category>Sports</category></programme>`,
      ),
      ids({ "espn.us": ["p:1", "p:2"] }),
      NOW,
    );
    for (const ch of ["p:1", "p:2"]) {
      const [p] = out.get(ch)!;
      expect(p.title).toBe("SportsCenter");
      expect(p.synopsis).toBe("Highlights.");
      expect(p.start.getTime()).toBe(NOW.getTime());
      expect(p.end.getTime()).toBe(NOW.getTime() + 3600_000);
    }
  });

  it("decodes entities and character references, keeps CDATA as written, drops markup", () => {
    const out = parseXmltv(
      doc(
        `<programme channel="a" start="${at(0)}" stop="${at(1)}"><title>Tom &amp; Jerry &#8211; &#x2019;Cats&apos; &lt;3</title>` +
          `<desc><![CDATA[Fish & <chips>]]> and <b>more</b></desc></programme>`,
      ),
      ids({ a: ["p:a"] }),
      NOW,
    );
    const [p] = out.get("p:a")!;
    expect(p.title).toBe("Tom & Jerry \u2013 \u2019Cats' <3");
    expect(p.synopsis).toBe("Fish & <chips> and more");
  });

  it("takes attributes in any order, either quote, with spacing; and an id's own entities", () => {
    const out = parseXmltv(
      doc(
        `<programme stop='${at(1)}'  channel = 'b&amp;c'\n start="${at(0)}"><title>One</title></programme>` +
          `<programme channel="b&amp;c" start="${at(1)}" stop="${at(2)}" ><title>Two</title></programme>`,
      ),
      ids({ "b&c": ["p:bc"] }),
      NOW,
    );
    expect(titles(out, "p:bc")).toEqual(["One", "Two"]);
  });

  it("is not fooled by a > inside an attribute, a longer tag name, or a self-closed programme", () => {
    const out = parseXmltv(
      doc(
        `<programmes/>` +
          `<programme channel="a" start="${at(0)}" stop="${at(1)}" note="x > y"><title>Kept</title></programme>` +
          `<programme channel="a" start="${at(1)}" stop="${at(2)}"/>` +
          `<programme channel="a" start="${at(2)}" stop="${at(3)}"><titles>no</titles><title>After</title></programme>`,
      ),
      ids({ a: ["p:a"] }),
      NOW,
    );
    // The self-closed one has no title, which is filler, so it goes.
    expect(titles(out, "p:a")).toEqual(["Kept", "After"]);
  });

  it("keeps the window, drops filler, sorts each channel by start", () => {
    const out = parseXmltv(
      doc(
        `<programme channel="a" start="${at(3)}" stop="${at(4)}"><title>Later</title></programme>` +
          `<programme channel="a" start="${at(-3)}" stop="${at(-2)}"><title>Long gone</title></programme>` +
          `<programme channel="a" start="${at(0)}" stop="${at(1)}"><title>To Be Announced</title></programme>` +
          `<programme channel="a" start="${at(1)}" stop="${at(2)}"><title>Sooner</title></programme>`,
      ),
      ids({ a: ["p:a"] }),
      NOW,
    );
    expect(titles(out, "p:a")).toEqual(["Sooner", "Later"]);
  });

  it("matches a guide id that differs only by case or spacing, and counts it", () => {
    const stats: XmltvStats = { guideChannels: 0, unmatchedOurs: [], unmatchedTheirs: [], recovered: 0 };
    const out = parseXmltv(
      doc(
        `<channel id="Sky.Fake"/><channel id="spare.one"/>` +
          `<programme channel="Sky.Fake" start="${at(0)}" stop="${at(1)}"><title>Sky Block</title></programme>`,
      ),
      ids({ "sky.fake": ["p:sky"], "nobody.here": ["p:none"] }),
      NOW,
      stats,
    );
    expect(titles(out, "p:sky")).toEqual(["Sky Block"]);
    expect(stats).toEqual({
      guideChannels: 2,
      recovered: 1,
      unmatchedOurs: ["nobody.here"],
      unmatchedTheirs: ["spare.one"],
    });
  });

  it("a bare & in a title costs that title its ampersand, not the whole guide", () => {
    const out = parseXmltv(
      doc(`<programme channel="a" start="${at(0)}" stop="${at(1)}"><title>Law & Order</title></programme>`),
      ids({ a: ["p:a"] }),
      NOW,
    );
    expect(titles(out, "p:a")).toEqual(["Law & Order"]);
  });
});

describe("the guide's own channel list", () => {
  it("is each channel's id and first display-name, in the guide's order", () => {
    const list = readGuideChannels(
      doc(
        `<channel id="espn.us"><display-name>ESPN</display-name><display-name>ESPN HD</display-name></channel>` +
          `<channel id="sky.uk"><display-name lang="en">  Sky Sports  </display-name></channel>` +
          `<programme channel="espn.us" start="${at(0)}" stop="${at(1)}"><title>x</title></programme>`,
      ),
    );
    expect(list).toEqual([
      { id: "espn.us", name: "ESPN" },
      { id: "sky.uk", name: "Sky Sports" },
    ]);
  });

  it("names a channel by its id when it has no display-name", () => {
    const list = readGuideChannels(
      doc(`<channel id="bare.id"/><channel id="empty.name"><display-name>  </display-name></channel><channel id="no.name"></channel>`),
    );
    expect(list).toEqual([
      { id: "bare.id", name: "bare.id" },
      { id: "empty.name", name: "empty.name" },
      { id: "no.name", name: "no.name" },
    ]);
  });

  it("decodes entities and CDATA in a name as it does in a title", () => {
    const list = readGuideChannels(
      doc(
        `<channel id="a&amp;b"><display-name>Tom &amp; Jerry &#8211; &#x2019;Cats&apos;</display-name></channel>` +
          `<channel id="c"><display-name><![CDATA[Fish & <chips>]]></display-name></channel>`,
      ),
    );
    expect(list).toEqual([
      { id: "a&b", name: "Tom & Jerry \u2013 \u2019Cats'" },
      { id: "c", name: "Fish & <chips>" },
    ]);
  });

  it("lists an id once, skips a channel with none, and is not fooled by programmes or a longer tag", () => {
    const list = readGuideChannels(
      doc(
        `<channels><channel id="one"><display-name>First</display-name></channel>` +
          `<channel id="one"><display-name>Again</display-name></channel>` +
          `<channel><display-name>No id</display-name></channel></channels>` +
          `<programme channel="one" start="${at(0)}" stop="${at(1)}"><title>x</title></programme>`,
      ),
    );
    expect(list).toEqual([{ id: "one", name: "First" }]);
  });

  it("comes back with the programmes, and without them when none of ours carries a guide id", () => {
    const xml = doc(
      `<channel id="espn.us"><display-name>ESPN</display-name></channel>` +
        `<channel id="other"><display-name>Other</display-name></channel>` +
        `<programme channel="espn.us" start="${at(0)}" stop="${at(1)}"><title>Live</title></programme>` +
        `<programme channel="other" start="${at(0)}" stop="${at(1)}"><title>Dropped</title></programme>`,
    );
    const both = parseGuide(xml, ids({ "espn.us": ["p:1"] }), NOW);
    expect(titles(both.programmes, "p:1")).toEqual(["Live"]);
    // The programmes of a channel nobody matched are still dropped. The names are not.
    expect(both.programmes.size).toBe(1);
    expect(both.channels.map((c) => c.id)).toEqual(["espn.us", "other"]);
    const none = parseGuide(xml, ids({}), NOW);
    expect(none.programmes.size).toBe(0);
    expect(none.channels.map((c) => c.name)).toEqual(["ESPN", "Other"]);
    // parseXmltv is the same parse, programmes only.
    expect(titles(parseXmltv(xml, ids({ "espn.us": ["p:1"] }), NOW), "p:1")).toEqual(["Live"]);
  });
});

describe("parseXmltvOffThread", () => {
  it("with no Worker (as here) parses on this thread, from the bytes, to the same answer", async () => {
    const xml = doc(`<programme channel="a" start="${at(0)}" stop="${at(1)}"><title>Caf\u00e9</title></programme>`);
    const bytes = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    const { programmes, chars } = await parseXmltvOffThread(bytes, ids({ a: ["p:a"] }), NOW);
    expect(titles(programmes, "p:a")).toEqual(["Caf\u00e9"]);
    expect(chars).toBe(xml.length);
  });

  it("brings the guide's channel list back with the programmes", async () => {
    const xml = doc(
      `<channel id="a"><display-name>Caf\u00e9 One</display-name></channel><channel id="z"/>` +
        `<programme channel="a" start="${at(0)}" stop="${at(1)}"><title>x</title></programme>`,
    );
    const bytes = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    const { channels } = await parseXmltvOffThread(bytes, ids({ a: ["p:a"] }), NOW);
    expect(channels).toEqual([
      { id: "a", name: "Caf\u00e9 One" },
      { id: "z", name: "z" },
    ]);
  });
});

describe("a programme with no stop (F17)", () => {
  it("runs until the next one on its channel; the last has nothing to end it", () => {
    const out = parseXmltv(
      doc(
        `<programme channel="a" start="${at(0)}"><title>Open</title></programme>` +
          `<programme channel="a" start="${at(1, 30)}" stop="${at(2)}"><title>Closed</title></programme>` +
          `<programme channel="a" start="${at(3)}"><title>Last</title></programme>`,
      ),
      ids({ a: ["p:1"] }),
      NOW,
    );
    const list = out.get("p:1")!;
    expect(list.map((p) => p.title)).toEqual(["Open", "Closed"]);
    expect(list[0].end.getTime()).toBe(list[1].start.getTime());
  });
});

describe("parseXmltvTime", () => {
  it("parses explicit offsets", () => {
    expect(parseXmltvTime("20260614200000 +0000")).toBe(
      Date.parse("2026-06-14T20:00:00Z"),
    );
    expect(parseXmltvTime("20260614200000 -0500")).toBe(
      Date.parse("2026-06-14T20:00:00-05:00"),
    );
    // No space before the offset — some panels omit it.
    expect(parseXmltvTime("20260614200000+0130")).toBe(
      Date.parse("2026-06-14T20:00:00+01:30"),
    );
  });

  it("defaults to UTC without an offset", () => {
    expect(parseXmltvTime("20260101000000")).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  it("reads a time cut short from the right, as the spec allows (F17)", () => {
    expect(parseXmltvTime("202606142030 +0000")).toBe(Date.parse("2026-06-14T20:30:00Z"));
    expect(parseXmltvTime("2026061420 +0000")).toBe(Date.parse("2026-06-14T20:00:00Z"));
    expect(parseXmltvTime("20260614")).toBe(Date.parse("2026-06-14T00:00:00Z"));
  });

  it("reads an offset written with a colon", () => {
    expect(parseXmltvTime("20260614200000 +05:30")).toBe(Date.parse("2026-06-14T20:00:00+05:30"));
    expect(parseXmltvTime("20260614200000 -03:00")).toBe(Date.parse("2026-06-14T20:00:00-03:00"));
  });

  it("rejects garbage", () => {
    expect(parseXmltvTime(undefined)).toBeNull();
    expect(parseXmltvTime("")).toBeNull();
    expect(parseXmltvTime("June 14th")).toBeNull();
    expect(parseXmltvTime("2026-06-14")).toBeNull();
  });
});

describe("isFillerTitle", () => {
  it("drops the classic placeholders", () => {
    for (const t of [
      "",
      "To Be Announced",
      "TBA",
      "No Information",
      "no info",
      "N/A",
      "Programme",
      "program.",
    ])
      expect(isFillerTitle(t), t).toBe(true);
  });

  it("keeps real titles", () => {
    for (const t of [
      "News at Ten",
      "TBA: The Documentary",
      "Programme of the Year Awards",
    ])
      expect(isFillerTitle(t), t).toBe(false);
  });
});
