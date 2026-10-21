import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage and a window that only hears events: the unit
// tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const bus = new EventTarget();
vi.stubGlobal("window", bus);

import {
  dropXtFor,
  eligiblePlaylists,
  hasXtLibrary,
  xtLibraryPending,
  isLibraryOff,
  loadHeld,
  loadPicks,
  saveHeld,
  setLibraryOff,
  setPicks,
  XT_CHANGED,
} from "./store";

const pl = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: "xtream",
  id,
  name: id,
  enabled: true,
  server: "http://panel.example.invalid:8080",
  username: "u",
  password: "p",
  ...extra,
});
const seed = (...list: unknown[]) => mem.set("blammytv.playlists", JSON.stringify({ v: 1, data: list }));

/** Picks, as the store keeps them. */
const m = (...ids: string[]) => ids.map((id) => ({ kind: "movie" as const, id }));
const sh = (...ids: string[]) => ids.map((id) => ({ kind: "series" as const, id }));

let said = 0;
bus.addEventListener(XT_CHANGED, () => said++);

beforeEach(() => {
  mem.clear();
  said = 0;
});

describe("the switch", () => {
  it("is on until it is turned off, per playlist", () => {
    expect(isLibraryOff("a")).toBe(false);
    setLibraryOff("a", true);
    expect(isLibraryOff("a")).toBe(true);
    expect(isLibraryOff("b")).toBe(false);
    setLibraryOff("a", false);
    expect(isLibraryOff("a")).toBe(false);
  });

  it("leaves nothing behind once it is back to the default", () => {
    setLibraryOff("a", true);
    setLibraryOff("a", false);
    expect(JSON.parse(mem.get("blammytv.xtVod")!).data).toEqual({});
  });

  it("keeps the picks when it goes off and on", () => {
    setPicks("a", m("12"));
    setLibraryOff("a", true);
    expect(loadPicks("a")).toEqual(m("12"));
    setLibraryOff("a", false);
    expect(loadPicks("a")).toEqual(m("12"));
  });
});

describe("the picks", () => {
  it("start empty, and are a playlist's own: a movie folder and a show folder share an id", () => {
    expect(loadPicks("a")).toEqual([]);
    setPicks("a", m("12"));
    expect(loadPicks("a")).toEqual(m("12"));
    expect(loadPicks("b")).toEqual([]);
    setPicks("a", [...m("12"), ...sh("12")]);
    expect(loadPicks("a")).toEqual([{ kind: "movie", id: "12" }, { kind: "series", id: "12" }]);
  });

  it("are one list in the order they were set, movies and shows mixed", () => {
    setPicks("a", [...sh("13"), ...m("14"), ...sh("12"), ...m("11")]);
    expect(loadPicks("a")).toEqual([...sh("13"), ...m("14"), ...sh("12"), ...m("11")]);
    // A drag is the same list in another order.
    setPicks("a", [...m("11"), ...sh("13"), ...sh("12"), ...m("14")]);
    expect(loadPicks("a").map((p) => `${p.kind}:${p.id}`)).toEqual(["movie:11", "series:13", "series:12", "movie:14"]);
  });

  it("hold a folder once, the first time it is named", () => {
    setPicks("a", [...m("1", "2", "1"), ...sh("1", "1")]);
    expect(loadPicks("a")).toEqual([...m("1", "2"), ...sh("1")]);
  });

  it("read as none from a save that is damaged or made by hand, and skip what is not a pick", () => {
    for (const bad of ['{"v":1,"data":[]}', '{"v":1,"data":{"a":5}}', '{"v":1,"data":{"a":{"picks":"12"}}}', '{"v":1,"data":{"a":{"picks":{"movie":"12"}}}}', "not json"]) {
      mem.set("blammytv.xtVod", bad);
      expect(loadPicks("a"), bad).toEqual([]);
      expect(isLibraryOff("a")).toBe(false);
    }
    const junk = [1, null, "movie:1", { kind: "movie" }, { kind: "tv", id: "1" }, { kind: "movie", id: 5 }, { kind: "series", id: "3" }, { kind: "movie", id: "4" }];
    mem.set("blammytv.xtVod", JSON.stringify({ v: 1, data: { a: { picks: junk } } }));
    expect(loadPicks("a")).toEqual([...sh("3"), ...m("4")]);
  });

  describe("saved before the order was the person's (v0.12.1 and v0.12.2)", () => {
    const old = (picks: unknown, extra: Record<string, unknown> = {}) =>
      mem.set("blammytv.xtVod", JSON.stringify({ v: 1, data: { a: { picks, ...extra } } }));

    it("are read as movies, then shows, each in its saved order", () => {
      old({ series: ["13", "12"], movie: ["12", "11"] });
      expect(loadPicks("a")).toEqual([...m("12", "11"), ...sh("13", "12")]);
    });

    it("are read when only one list is there, skipping what is not an id", () => {
      old({ movie: ["12", 7, null, "12"] });
      expect(loadPicks("a")).toEqual(m("12"));
      old({ series: ["3"], movie: "nope" });
      expect(loadPicks("a")).toEqual(sh("3"));
    });

    it("leave the saved text alone until something changes, and are then written as the list", () => {
      old({ movie: ["12"], series: ["13"] });
      const before = mem.get("blammytv.xtVod");
      setPicks("a", loadPicks("a"));
      setLibraryOff("a", false);
      expect(mem.get("blammytv.xtVod")).toBe(before);
      expect(said).toBe(0);
      setPicks("a", [...sh("13"), ...m("12")]);
      expect(JSON.parse(mem.get("blammytv.xtVod")!).data).toEqual({ a: { picks: [{ kind: "series", id: "13" }, { kind: "movie", id: "12" }] } });
      expect(said).toBe(1);
    });

    it("are kept, in the new shape, when the switch is flipped", () => {
      old({ movie: ["12"], series: ["13"] });
      setLibraryOff("a", true);
      expect(JSON.parse(mem.get("blammytv.xtVod")!).data).toEqual({ a: { off: true, picks: [{ kind: "movie", id: "12" }, { kind: "series", id: "13" }] } });
    });

    it("stay under the same version, so the older build's settings file and this build's read the same", () => {
      old({ movie: ["12"] });
      expect(JSON.parse(mem.get("blammytv.xtVod")!).v).toBe(1);
      setPicks("a", m("12", "13"));
      expect(JSON.parse(mem.get("blammytv.xtVod")!).v).toBe(1);
    });
  });
});

describe("XT_CHANGED", () => {
  it("is said on every write, and not when nothing changed", () => {
    setPicks("a", m("12"));
    expect(said).toBe(1);
    setLibraryOff("a", true);
    expect(said).toBe(2);
    setLibraryOff("a", true);
    setPicks("a", m("12"));
    expect(said).toBe(2);
    setPicks("a", []);
    expect(said).toBe(3);
  });

  it("is said when only the order changed", () => {
    setPicks("a", m("1", "2"));
    said = 0;
    setPicks("a", m("2", "1"));
    expect(said).toBe(1);
  });

  it("is not said for what the last load held, which is the app's bookkeeping", () => {
    saveHeld("a", { movies: 5, shows: 1 });
    expect(said).toBe(0);
  });
});

describe("what the last good load held", () => {
  it("is kept per playlist, and says whether it changed", () => {
    expect(loadHeld("a")).toBeNull();
    expect(saveHeld("a", { movies: 5, shows: 2 })).toBe(true);
    expect(saveHeld("a", { movies: 5, shows: 2 })).toBe(false);
    expect(loadHeld("a")).toEqual({ movies: 5, shows: 2 });
    expect(saveHeld("a", { movies: 6, shows: 2 })).toBe(true);
    expect(loadHeld("b")).toBeNull();
  });

  it("is its own key, apart from the choices a person made", () => {
    saveHeld("a", { movies: 1, shows: 1 });
    expect(mem.has("blammytv.xtVod")).toBe(false);
  });
});

describe("eligiblePlaylists", () => {
  it("is the Xtream playlists that are enabled, in order, whose library is not off", () => {
    seed(
      pl("a"),
      { kind: "m3u", id: "m", name: "m", enabled: true, url: "http://x.invalid/l.m3u" },
      pl("b", { enabled: false }),
      pl("c"),
      pl("d"),
    );
    setLibraryOff("d", true);
    expect(eligiblePlaylists().map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("leaves out a playlist with no usable account instead of throwing on it", () => {
    seed(pl("a"), pl("b", { server: undefined }));
    expect(eligiblePlaylists().map((p) => p.id)).toEqual(["a"]);
  });

  it("ignores the choices of a playlist that is gone", () => {
    seed(pl("a"));
    setPicks("gone", m("1"));
    setLibraryOff("gone", true);
    expect(eligiblePlaylists().map((p) => p.id)).toEqual(["a"]);
  });
});

describe("hasXtLibrary", () => {
  it("is false at first: nothing has been seen to hold a movie or a show", () => {
    seed(pl("a"));
    expect(hasXtLibrary()).toBe(false);
  });

  it("is true once an eligible playlist's last good load held a movie or a show", () => {
    seed(pl("a"), pl("b"));
    saveHeld("b", { movies: 0, shows: 3 });
    expect(hasXtLibrary()).toBe(true);
  });

  it("is false for a playlist that is live TV only: its load held nothing", () => {
    seed(pl("a"));
    saveHeld("a", { movies: 0, shows: 0 });
    expect(hasXtLibrary()).toBe(false);
  });

  it("is false when the playlist is disabled, its library is off, or it is removed", () => {
    seed(pl("a", { enabled: false }), pl("b"));
    saveHeld("a", { movies: 9, shows: 9 });
    saveHeld("b", { movies: 9, shows: 9 });
    saveHeld("gone", { movies: 9, shows: 9 });
    expect(hasXtLibrary()).toBe(true);
    setLibraryOff("b", true);
    expect(hasXtLibrary()).toBe(false);
  });

  it("answers without a fetch and without a window: it only reads", () => {
    expect(hasXtLibrary()).toBe(false);
  });
});

describe("xtLibraryPending", () => {
  it("is true while an eligible playlist has never been read", () => {
    seed(pl("a"), pl("b"));
    saveHeld("a", { movies: 0, shows: 0 });
    expect(xtLibraryPending()).toBe(true);
  });

  it("is false once every eligible playlist has been read, holding something or nothing", () => {
    seed(pl("a"), pl("b"));
    saveHeld("a", { movies: 0, shows: 0 });
    saveHeld("b", { movies: 4, shows: 0 });
    expect(xtLibraryPending()).toBe(false);
  });

  it("does not wait on a playlist that is disabled or switched off", () => {
    seed(pl("a", { enabled: false }), pl("b"));
    setLibraryOff("b", true);
    expect(xtLibraryPending()).toBe(false);
  });
});

describe("a playlist that is gone", () => {
  it("takes its choices and its record of what it held, and returns who it took", () => {
    setLibraryOff("a", true);
    setPicks("b", m("12"));
    setPicks("c", sh("3"));
    saveHeld("a", { movies: 1, shows: 2 });
    saveHeld("b", { movies: 3, shows: 0 });
    saveHeld("c", { movies: 0, shows: 4 });
    expect(dropXtFor(["b"]).sort()).toEqual(["a", "c"]);
    expect(isLibraryOff("a")).toBe(false);
    expect(loadHeld("a")).toBeNull();
    expect(loadPicks("c")).toEqual([]);
    expect(loadHeld("c")).toBeNull();
    expect(loadPicks("b")).toEqual(m("12"));
    expect(loadHeld("b")).toEqual({ movies: 3, shows: 0 });
  });

  it("takes one that has only a record of what it held, or only a choice", () => {
    saveHeld("a", { movies: 1, shows: 0 });
    setLibraryOff("b", true);
    expect(dropXtFor([]).sort()).toEqual(["a", "b"]);
    expect(mem.get("blammytv.xtVod")).toBe(JSON.stringify({ v: 1, data: {} }));
    expect(mem.get("blammytv.xtVodHeld")).toBe(JSON.stringify({ v: 1, data: {} }));
  });

  it("writes nothing and says nothing when every playlist is still there", () => {
    setPicks("a", m("1"));
    saveHeld("a", { movies: 1, shows: 0 });
    const before = [...mem.entries()];
    said = 0;
    expect(dropXtFor(["a", "z"])).toEqual([]);
    expect([...mem.entries()]).toEqual(before);
    expect(said).toBe(0);
  });

  it("says nothing when it takes one: nothing draws a removed playlist's choices", () => {
    setLibraryOff("a", true);
    said = 0;
    dropXtFor([]);
    expect(said).toBe(0);
  });

  it("copes with a store that holds nothing, or junk", () => {
    expect(dropXtFor(["a"])).toEqual([]);
    mem.set("blammytv.xtVod", JSON.stringify({ v: 1, data: [1, 2] }));
    mem.set("blammytv.xtVodHeld", JSON.stringify({ v: 1, data: "junk" }));
    expect(dropXtFor(["a"])).toEqual([]);
  });
});
