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
  eligiblePlaylists,
  hasXtLibrary,
  xtLibraryPending,
  isLibraryOff,
  loadHeld,
  loadPicks,
  saveHeld,
  setLibraryOff,
  setPicks,
  togglePick,
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
    setPicks("a", "movie", ["12"]);
    setLibraryOff("a", true);
    expect(loadPicks("a", "movie")).toEqual(["12"]);
    setLibraryOff("a", false);
    expect(loadPicks("a", "movie")).toEqual(["12"]);
  });
});

describe("the picks", () => {
  it("start empty, and are two lists per playlist: a movie folder and a show folder share an id", () => {
    expect(loadPicks("a", "movie")).toEqual([]);
    togglePick("a", "movie", "12");
    expect(loadPicks("a", "movie")).toEqual(["12"]);
    expect(loadPicks("a", "series")).toEqual([]);
    expect(loadPicks("b", "movie")).toEqual([]);
  });

  it("toggle: a click picks, the next unpicks", () => {
    togglePick("a", "series", "13");
    togglePick("a", "series", "14");
    expect(loadPicks("a", "series")).toEqual(["13", "14"]);
    togglePick("a", "series", "13");
    expect(loadPicks("a", "series")).toEqual(["14"]);
  });

  it("hold a folder once", () => {
    setPicks("a", "movie", ["1", "2", "1"]);
    expect(loadPicks("a", "movie")).toEqual(["1", "2"]);
  });

  it("read as none from a save that is damaged or made by hand", () => {
    for (const bad of ['{"v":1,"data":[]}', '{"v":1,"data":{"a":5}}', '{"v":1,"data":{"a":{"picks":{"movie":"12"}}}}', "not json"]) {
      mem.set("blammytv.xtVod", bad);
      expect(loadPicks("a", "movie")).toEqual([]);
      expect(isLibraryOff("a")).toBe(false);
    }
    mem.set("blammytv.xtVod", '{"v":1,"data":{"a":{"picks":{"movie":["1",2,null,"3"]}}}}');
    expect(loadPicks("a", "movie")).toEqual(["1", "3"]);
  });
});

describe("XT_CHANGED", () => {
  it("is said on every write, and not when nothing changed", () => {
    togglePick("a", "movie", "12");
    expect(said).toBe(1);
    setLibraryOff("a", true);
    expect(said).toBe(2);
    setLibraryOff("a", true);
    setPicks("a", "movie", ["12"]);
    expect(said).toBe(2);
    togglePick("a", "movie", "12");
    expect(said).toBe(3);
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
    setPicks("gone", "movie", ["1"]);
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
