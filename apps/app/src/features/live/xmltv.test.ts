import { describe, expect, it } from "vitest";
import { isFillerTitle, parseXmltv, parseXmltvTime, type XmltvStats } from "./xmltv";
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

describe("parseXmltvOffThread", () => {
  it("with no Worker (as here) parses on this thread, from the bytes, to the same answer", async () => {
    const xml = doc(`<programme channel="a" start="${at(0)}" stop="${at(1)}"><title>Caf\u00e9</title></programme>`);
    const bytes = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    const { programmes, chars } = await parseXmltvOffThread(bytes, ids({ a: ["p:a"] }), NOW);
    expect(titles(programmes, "p:a")).toEqual(["Caf\u00e9"]);
    expect(chars).toBe(xml.length);
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
