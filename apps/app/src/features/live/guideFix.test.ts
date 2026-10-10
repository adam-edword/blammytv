import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyGuideFixes,
  keepGuideFixesFor,
  loadGuideFixes,
  removeGuideFix,
  saveGuideFix,
} from "./guideFix";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const idx = (o: Record<string, string[]>) => new Map(Object.entries(o));
const everyone = (...ids: string[]) => new Set(ids);

describe("applyGuideFixes", () => {
  it("moves a channel from the guide id it came with to the one it was given", () => {
    const out = applyGuideFixes(
      idx({ "wrong.id": ["p:1"], "espn.us": ["p:2"] }),
      { "p:1": "espn.us" },
      everyone("p:1", "p:2"),
    );
    expect(Object.fromEntries(out)).toEqual({ "espn.us": ["p:2", "p:1"] });
  });

  it("takes a channel the guide never had an id for: it is in no list yet", () => {
    const out = applyGuideFixes(idx({ "espn.us": ["p:2"] }), { "p:9": "sky.uk" }, everyone("p:2", "p:9"));
    expect(Object.fromEntries(out)).toEqual({ "espn.us": ["p:2"], "sky.uk": ["p:9"] });
  });

  it("keeps a shared feed's other channels where they were", () => {
    // Three channels share one id (the HD, SD and backup of one channel).
    const out = applyGuideFixes(
      idx({ "bbc.one": ["p:1", "p:2", "p:3"] }),
      { "p:2": "bbc.two" },
      everyone("p:1", "p:2", "p:3"),
    );
    expect(Object.fromEntries(out)).toEqual({ "bbc.one": ["p:1", "p:3"], "bbc.two": ["p:2"] });
  });

  it("joins the channels a guide id already has, and drops an id left with none", () => {
    const out = applyGuideFixes(
      idx({ a: ["p:1"], b: ["p:2", "p:3"] }),
      { "p:1": "b" },
      everyone("p:1", "p:2", "p:3"),
    );
    expect(Object.fromEntries(out)).toEqual({ b: ["p:2", "p:3", "p:1"] });
  });

  it("ignores a fix for a channel this build does not have", () => {
    const index = idx({ "espn.us": ["p:2"] });
    const out = applyGuideFixes(index, { "p:gone": "espn.us", "p:2": "" }, everyone("p:2"));
    // Nothing applied, so the very same map comes back.
    expect(out).toBe(index);
  });

  it("applies the ones it can when others are for channels it has not", () => {
    const out = applyGuideFixes(
      idx({ a: ["p:1"] }),
      { "p:gone": "a", "p:1": "z" },
      everyone("p:1"),
    );
    expect(Object.fromEntries(out)).toEqual({ z: ["p:1"] });
  });

  it("leaves its input as it was", () => {
    const list = ["p:1", "p:2"];
    const index = idx({ a: list });
    applyGuideFixes(index, { "p:1": "b" }, everyone("p:1", "p:2"));
    expect(list).toEqual(["p:1", "p:2"]);
    expect(Object.fromEntries(index)).toEqual({ a: ["p:1", "p:2"] });
  });

  it("moves a channel listed twice (a stream filed under two categories) once", () => {
    const out = applyGuideFixes(idx({ a: ["p:1", "p:1", "p:2"] }), { "p:1": "b" }, everyone("p:1", "p:2"));
    expect(Object.fromEntries(out)).toEqual({ a: ["p:2"], b: ["p:1"] });
  });
});

describe("the saved fixes", () => {
  beforeEach(() => mem.clear());

  it("start empty", () => {
    expect(loadGuideFixes("p")).toEqual({});
  });

  it("save a fix per channel, and a second save replaces the first", () => {
    saveGuideFix("p", "p:1", "a");
    saveGuideFix("p", "p:2", "b");
    expect(loadGuideFixes("p")).toEqual({ "p:1": "a", "p:2": "b" });
    expect(saveGuideFix("p", "p:1", "c")).toEqual({ "p:1": "c", "p:2": "b" });
    expect(loadGuideFixes("p")).toEqual({ "p:1": "c", "p:2": "b" });
  });

  it("remove one, and leave the rest", () => {
    saveGuideFix("p", "p:1", "a");
    saveGuideFix("p", "p:2", "b");
    expect(removeGuideFix("p", "p:1")).toEqual({ "p:2": "b" });
    expect(loadGuideFixes("p")).toEqual({ "p:2": "b" });
    removeGuideFix("p", "p:2");
    expect(loadGuideFixes("p")).toEqual({});
    // Taking away what is not there is nothing.
    expect(removeGuideFix("p", "p:nope")).toEqual({});
  });

  it("are kept per playlist", () => {
    saveGuideFix("p", "p:1", "a");
    saveGuideFix("q", "q:1", "z");
    expect(loadGuideFixes("p")).toEqual({ "p:1": "a" });
    expect(loadGuideFixes("q")).toEqual({ "q:1": "z" });
    removeGuideFix("p", "p:1");
    expect(loadGuideFixes("q")).toEqual({ "q:1": "z" });
  });

  it("go with the playlist", () => {
    saveGuideFix("p", "p:1", "a");
    saveGuideFix("q", "q:1", "z");
    keepGuideFixesFor(["q"]);
    expect(loadGuideFixes("p")).toEqual({});
    expect(loadGuideFixes("q")).toEqual({ "q:1": "z" });
    keepGuideFixesFor([]);
    expect(loadGuideFixes("q")).toEqual({});
  });

  it("read a damaged store as no fixes, and keep what is sound in a half-damaged one", () => {
    localStorage.setItem("blammytv.guideFixes", JSON.stringify({ v: 1, data: ["not", "a", "map"] }));
    expect(loadGuideFixes("p")).toEqual({});
    localStorage.setItem(
      "blammytv.guideFixes",
      JSON.stringify({ v: 1, data: { p: { "p:1": "a", "p:2": 7, "p:3": "" }, q: "bad", r: ["x"] } }),
    );
    expect(loadGuideFixes("p")).toEqual({ "p:1": "a" });
    expect(loadGuideFixes("q")).toEqual({});
    expect(loadGuideFixes("r")).toEqual({});
    // A version it does not know is a clean slate.
    localStorage.setItem("blammytv.guideFixes", JSON.stringify({ v: 99, data: { p: { "p:1": "a" } } }));
    expect(loadGuideFixes("p")).toEqual({});
  });
});
