import { describe, expect, it } from "vitest";
import { extraGuideUrl, fillGaps, gapIndex, hasProgrammes, listBothGuides } from "./extraGuide";
import type { Programme } from "./model";

const prog = (title: string): Programme => ({
  title,
  start: new Date("2026-09-24T19:00:00Z"),
  end: new Date("2026-09-24T20:00:00Z"),
});
const map = (o: Record<string, string[]>) => new Map(Object.entries(o).map(([id, t]) => [id, t.map(prog)]));
const titles = (m: Map<string, Programme[]>, id: string) => m.get(id)?.map((p) => p.title);

describe("extraGuideUrl", () => {
  it("is the address, trimmed, for http and https", () => {
    expect(extraGuideUrl("  https://example.com/guide.xml?x=1 ")).toBe("https://example.com/guide.xml?x=1");
    expect(extraGuideUrl("http://example.com/g.xml.gz")).toBe("http://example.com/g.xml.gz");
  });

  it("is none for nothing, for what is not text, and for any other kind of address", () => {
    for (const none of [undefined, null, "", "   ", 5, {}, "example.com/guide.xml", "ftp://example.com/g.xml", "file:///C:/g.xml", "javascript:alert(1)", "data:text/xml,<tv/>", "\\\\host\\share\\g.xml", "not a url"])
      expect(extraGuideUrl(none), JSON.stringify(none)).toBeUndefined();
  });
});

describe("gapIndex", () => {
  const index = new Map([
    ["a.epg", ["p:1"]],
    ["b.epg", ["p:2", "p:3"]],
    ["c.epg", ["p:4"]],
  ]);

  it("holds only the channels with no programmes", () => {
    const have = new Set(["p:1", "p:3"]);
    const gaps = gapIndex(index, (id) => have.has(id));
    // a.epg is covered; b.epg keeps only the channel that is not; c.epg is a gap.
    expect(Object.fromEntries(gaps)).toEqual({ "b.epg": ["p:2"], "c.epg": ["p:4"] });
  });

  it("is empty when everything is covered, and the whole index when nothing is", () => {
    expect(gapIndex(index, () => true).size).toBe(0);
    expect(Object.fromEntries(gapIndex(index, () => false))).toEqual(Object.fromEntries(index));
  });

  it("leaves the index it was given as it was", () => {
    gapIndex(index, (id) => id === "p:2");
    expect(index.get("b.epg")).toEqual(["p:2", "p:3"]);
    expect(index.size).toBe(3);
  });
});

describe("hasProgrammes", () => {
  it("is a list with something in it, and not a missing one or an empty one", () => {
    const m = map({ a: ["x"], b: [] });
    expect(hasProgrammes(m, "a")).toBe(true);
    expect(hasProgrammes(m, "b")).toBe(false);
    expect(hasProgrammes(m, "c")).toBe(false);
  });
});

describe("fillGaps", () => {
  it("keeps the provider's programmes where it has them, fills a gap, and leaves a channel in neither empty", () => {
    const provider = map({ "p:1": ["Provider One"], "p:4": ["Provider Four"] });
    const extra = map({ "p:2": ["Extra Two"], "p:4": ["Extra Four"] });
    const out = fillGaps(provider, extra);
    expect(titles(out, "p:1")).toEqual(["Provider One"]);
    expect(titles(out, "p:4")).toEqual(["Provider Four"]);
    expect(titles(out, "p:2")).toEqual(["Extra Two"]);
    expect(out.has("p:3")).toBe(false);
  });

  it("fills a channel whose list is empty, and does not put an empty list in", () => {
    const into = map({ "p:1": [] });
    fillGaps(into, new Map([["p:1", [prog("Filled")]], ["p:2", []]]));
    expect(titles(into, "p:1")).toEqual(["Filled"]);
    expect(into.has("p:2")).toBe(false);
  });

  it("makes what goes in ready the way the caller says, and only what goes in", () => {
    const into = map({ "p:1": ["Provider"] });
    const prepared: string[] = [];
    fillGaps(into, map({ "p:1": ["Skipped"], "p:2": ["Used"] }), (l) => {
      prepared.push(l[0].title);
      return l;
    });
    expect(prepared).toEqual(["Used"]);
  });

  it("is the provider's own map, unchanged, for no fills", () => {
    const into = map({ "p:1": ["Provider"] });
    expect(fillGaps(into, undefined)).toBe(into);
    expect(titles(into, "p:1")).toEqual(["Provider"]);
  });
});

describe("listBothGuides", () => {
  const a = [
    { id: "one", name: "One" },
    { id: "two", name: "Two" },
  ];

  it("lists the provider's guide's channels first and the extra guide's after", () => {
    const out = listBothGuides(a, [
      { id: "three", name: "Three" },
      { id: "four", name: "Four" },
    ]);
    expect(out.map((c) => c.id)).toEqual(["one", "two", "three", "four"]);
  });

  it("lists an id once, as the provider's guide named it", () => {
    const out = listBothGuides(a, [
      { id: "two", name: "Two (extra)" },
      { id: "three", name: "Three" },
      { id: "three", name: "Three again" },
    ]);
    expect(out).toEqual([...a, { id: "three", name: "Three" }]);
  });

  it("is the extra guide's alone for a playlist whose own guide was never read, and the provider's alone for no extra", () => {
    expect(listBothGuides(undefined, a)).toEqual(a);
    expect(listBothGuides(a, undefined)).toEqual(a);
    expect(listBothGuides(a, [])).toEqual(a);
    expect(listBothGuides(undefined, undefined)).toEqual([]);
  });

  it("does not change what it was given", () => {
    const base = [...a];
    listBothGuides(base, [{ id: "z", name: "Z" }]);
    expect(base).toEqual(a);
  });
});
