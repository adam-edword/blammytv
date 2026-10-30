import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: stub the browser globals the storage seam and the change
// event read.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});
vi.stubGlobal("window", new EventTarget());

import {
  homeRows,
  loadHomeRows,
  loadOffered,
  onHomeRowsChange,
  reorderWithin,
  fitsStrand,
  isLive,
  removable,
  saveHomeRows,
  savedId,
  STRAND_MAX,
  seedHomeRows,
  withAutoRows,
  withNewCatalogRows,
  type HomeRow,
  type HomeRowKind,
} from "./layout";

const put = (data: unknown, v = 1) => store.set("blammytv.homeRows", JSON.stringify({ v, data }));
const ids = (rows: readonly HomeRow[]) => rows.map((r) => r.id);

describe("loadHomeRows", () => {
  beforeEach(() => store.clear());

  it("is null before Home has been set up", () => {
    expect(loadHomeRows()).toBeNull();
  });

  it("keeps what was saved, in order, with titles", () => {
    saveHomeRows([
      { id: "carousel", kind: "carousel", on: false },
      { id: "aio:b", kind: "catalog", on: true, title: "Mine" },
      { id: "continue", kind: "continue", on: true },
    ]);
    expect(loadHomeRows()).toEqual([
      { id: "carousel", kind: "carousel", on: false },
      { id: "aio:b", kind: "catalog", on: true, title: "Mine" },
      { id: "continue", kind: "continue", on: true },
    ]);
  });

  it("drops a kind it does not know, and a row that is not a row", () => {
    put([
      { id: "continue", kind: "continue", on: true },
      { id: "x", kind: "saved", on: true },
      { id: "y", kind: "hologram", on: true },
      "continue",
      null,
      { id: "aio:a", kind: "catalog", on: "yes" },
      { id: "", kind: "catalog", on: true },
      { id: "aio:a", kind: "catalog", on: true },
    ]);
    expect(loadHomeRows()).toEqual([
      { id: "continue", kind: "continue", on: true },
      { id: "aio:a", kind: "catalog", on: true },
    ]);
  });

  it("is null for a value that is not a list, or holds nothing usable", () => {
    put("carousel");
    expect(loadHomeRows()).toBeNull();
    put({ rows: [] });
    expect(loadHomeRows()).toBeNull();
    put([{ id: "x", kind: "hologram", on: true }]);
    expect(loadHomeRows()).toBeNull();
    put([{ id: "continue", kind: "continue", on: true }], 2);
    expect(loadHomeRows()).toBeNull();
  });

  it("holds a single row once, whatever id it was stored under", () => {
    put([
      { id: "a", kind: "continue", on: false },
      { id: "b", kind: "continue", on: true },
    ]);
    expect(loadHomeRows()).toEqual([{ id: "continue", kind: "continue", on: false }]);
  });

  it("keeps the carousel on top", () => {
    put([
      { id: "continue", kind: "continue", on: true },
      { id: "aio:a", kind: "catalog", on: true },
      { id: "carousel", kind: "carousel", on: true },
    ]);
    expect(ids(loadHomeRows()!)).toEqual(["carousel", "continue", "aio:a"]);
  });

  it("drops a blank title", () => {
    put([{ id: "continue", kind: "continue", on: true, title: "  " }]);
    expect(loadHomeRows()).toEqual([{ id: "continue", kind: "continue", on: true }]);
  });
});

describe("seedHomeRows", () => {
  it("is the carousel, Continue Watching, Up Next, then the catalog rows in order", () => {
    const rows = seedHomeRows({ carousel: true, catalogIds: ["aio:b", "jf:a", "xt:c"] });
    expect(ids(rows)).toEqual(["carousel", "continue", "upnext", "aio:b", "jf:a", "xt:c"]);
    expect(rows.every((r) => r.on)).toBe(true);
  });

  it("switches the carousel as Appearance's switch is", () => {
    expect(seedHomeRows({ carousel: false, catalogIds: [] })[0]).toEqual({ id: "carousel", kind: "carousel", on: false });
  });

  it("holds a catalog id once", () => {
    expect(ids(seedHomeRows({ carousel: true, catalogIds: ["aio:a", "aio:a"] }))).toEqual(["carousel", "continue", "upnext", "aio:a"]);
  });
});

describe("homeRows", () => {
  beforeEach(() => store.clear());

  it("seeds on the first call and keeps that set after", () => {
    store.set("blammytv.showHero", JSON.stringify({ v: 1, data: false }));
    expect(ids(homeRows(["aio:a"]))).toEqual(["carousel", "continue", "upnext", "aio:a"]);
    expect(loadHomeRows()?.[0].on).toBe(false);
    // A later call with other rows seeds nothing again.
    expect(ids(homeRows(["aio:z"]))).toEqual(["carousel", "continue", "upnext", "aio:a"]);
  });
});

describe("withNewCatalogRows", () => {
  const base = seedHomeRows({ carousel: true, catalogIds: ["aio:a"] });

  it("adds a catalog row it lacks at the end, switched on", () => {
    const next = withNewCatalogRows(base, ["aio:a", "jf:z"]);
    expect(next.at(-1)).toEqual({ id: "jf:z", kind: "catalog", on: true });
    expect(next).toHaveLength(base.length + 1);
  });

  it("adds it once, however often it is asked", () => {
    const once = withNewCatalogRows(base, ["jf:z"]);
    const twice = withNewCatalogRows(once, ["jf:z"]);
    expect(twice).toBe(once);
    expect(ids(twice).filter((id) => id === "jf:z")).toHaveLength(1);
    expect(ids(withNewCatalogRows(base, ["jf:z", "jf:z"])).filter((id) => id === "jf:z")).toHaveLength(1);
  });

  it("leaves a row the person switched off, moved or renamed where it is", () => {
    const edited: HomeRow[] = [
      { id: "aio:a", kind: "catalog", on: false, title: "Mine" },
      ...base.filter((r) => r.id !== "aio:a"),
    ];
    expect(withNewCatalogRows(edited, ["aio:a"])).toBe(edited);
  });

  it("is the same list when nothing is new", () => {
    expect(withNewCatalogRows(base, ["aio:a"])).toBe(base);
    expect(withNewCatalogRows(base, [])).toBe(base);
  });
});

describe("the live rows", () => {
  beforeEach(() => store.clear());

  it("validate: each exists once, under its kind, and the rest of their fields are kept", () => {
    put([
      { id: "a", kind: "onnow", on: true, title: " Tonight " },
      { id: "b", kind: "recent", on: false },
      { id: "c", kind: "games", on: true },
      { id: "d", kind: "recordings", on: true },
      { id: "e", kind: "onnow", on: false },
    ]);
    expect(loadHomeRows()).toEqual([
      { id: "onnow", kind: "onnow", on: true, title: "Tonight" },
      { id: "recent", kind: "recent", on: false },
      { id: "games", kind: "games", on: true },
      { id: "recordings", kind: "recordings", on: true },
    ]);
  });

  it("can be removed, and the four kinds Home always has cannot", () => {
    expect(["onnow", "recent", "games", "recordings"].every((k) => removable(k as HomeRowKind))).toBe(true);
    expect(["carousel", "continue", "upnext", "catalog"].some((k) => removable(k as HomeRowKind))).toBe(false);
  });
});

describe("seedHomeRows with a live source", () => {
  it("puts On Now and Today's Games after Up Next, before the catalog", () => {
    const rows = seedHomeRows({ carousel: true, catalogIds: ["aio:a"], live: true });
    expect(ids(rows)).toEqual(["carousel", "continue", "upnext", "onnow", "games", "aio:a"]);
    expect(rows.every((r) => r.on)).toBe(true);
  });

  it("leaves them out without one", () => {
    expect(ids(seedHomeRows({ carousel: true, catalogIds: ["aio:a"] }))).toEqual(["carousel", "continue", "upnext", "aio:a"]);
    expect(ids(seedHomeRows({ carousel: true, catalogIds: [], live: false }))).toEqual(["carousel", "continue", "upnext"]);
  });
});

describe("withAutoRows", () => {
  beforeEach(() => store.clear());
  const base = seedHomeRows({ carousel: true, catalogIds: ["aio:a"] });

  it("adds On Now and Today's Games at the end, switched on, once there is a live source", () => {
    const next = withAutoRows(base, [], true);
    expect(next.slice(-2)).toEqual([
      { id: "onnow", kind: "onnow", on: true },
      { id: "games", kind: "games", on: true },
    ]);
    expect(next).toHaveLength(base.length + 2);
  });

  it("adds nothing without a live source, and the same array back", () => {
    expect(withAutoRows(base, [], false)).toBe(base);
  });

  it("offers a layout from phase 1 the two, and records that it did", () => {
    // The bare list phase 1 stored: nothing offered.
    put(base);
    const stored = loadHomeRows()!;
    expect(loadOffered()).toEqual([]);
    saveHomeRows(withAutoRows(stored, loadOffered(), true));
    expect(ids(loadHomeRows()!).slice(-2)).toEqual(["onnow", "games"]);
    expect(loadOffered()).toEqual(["onnow", "games"]);
  });

  it("does not add one again after it was removed", () => {
    saveHomeRows(withAutoRows(base, [], true));
    // Taken off Home in Settings → Home.
    saveHomeRows(loadHomeRows()!.filter((r) => r.kind !== "onnow"));
    const left = loadHomeRows()!;
    expect(ids(left)).not.toContain("onnow");
    // Read back from storage, as the next launch reads it.
    expect(loadOffered()).toEqual(["onnow", "games"]);
    expect(withAutoRows(left, loadOffered(), true)).toBe(left);
  });

  it("does not add one that is added by hand and then removed", () => {
    // Offered only by being there: Add Row put it in, a remove took it out.
    saveHomeRows([...base, { id: "games", kind: "games", on: true }]);
    saveHomeRows(loadHomeRows()!.filter((r) => r.kind !== "games"));
    expect(ids(withAutoRows(loadHomeRows()!, loadOffered(), true))).toEqual([...ids(base), "onnow"]);
  });

  it("does not offer Recent Channels or Recordings on its own", () => {
    expect(ids(withAutoRows(base, [], true))).not.toContain("recent");
    expect(ids(withAutoRows(base, [], true))).not.toContain("recordings");
  });

  it("leaves one that is there alone, switched off or not", () => {
    const kept: HomeRow[] = [...base, { id: "onnow", kind: "onnow", on: false }];
    expect(ids(withAutoRows(kept, [], true)).filter((id) => id === "onnow")).toHaveLength(1);
  });
});

describe("offered, as stored", () => {
  beforeEach(() => store.clear());
  const rows = [{ id: "continue", kind: "continue", on: true }];

  it("is read back from the box, and only the auto kinds in it", () => {
    put({ rows, offered: ["games", "recent", "hologram", "games"] });
    expect(loadOffered()).toEqual(["games"]);
    expect(loadHomeRows()).toEqual(rows);
  });

  it("is empty for a box with no list, or a list that is not one", () => {
    put({ rows });
    expect(loadOffered()).toEqual([]);
    put({ rows, offered: "onnow" });
    expect(loadOffered()).toEqual([]);
  });

  it("counts a live row that is in the rows as offered, whatever was written", () => {
    put({ rows: [...rows, { id: "onnow", kind: "onnow", on: true }], offered: [] });
    expect(loadOffered()).toEqual(["onnow"]);
  });

  it("is null as a layout when the box holds no rows", () => {
    put({ rows: [], offered: ["onnow"] });
    expect(loadHomeRows()).toBeNull();
    expect(loadOffered()).toEqual([]);
  });

  it("homeRows seeds with the live rows and writes them down as offered", () => {
    expect(ids(homeRows(["aio:a"], true))).toEqual(["carousel", "continue", "upnext", "onnow", "games", "aio:a"]);
    expect(loadOffered()).toEqual(["onnow", "games"]);
    store.clear();
    expect(ids(homeRows(["aio:a"]))).toEqual(["carousel", "continue", "upnext", "aio:a"]);
    expect(loadOffered()).toEqual([]);
  });
});

describe("onHomeRowsChange", () => {
  beforeEach(() => store.clear());

  it("hears a save, and stops when asked", () => {
    const seen: string[][] = [];
    const off = onHomeRowsChange((rows) => seen.push(ids(rows)));
    saveHomeRows([{ id: "continue", kind: "continue", on: true }]);
    off();
    saveHomeRows([{ id: "upnext", kind: "upnext", on: true }]);
    expect(seen).toEqual([["continue"]]);
  });
});

describe("the list rows", () => {
  beforeEach(() => store.clear());

  it("Saved: one row for each Library list, under an id made from the list", () => {
    put([
      { id: "x", kind: "saved", list: "l1", on: true, title: " Weekend " },
      { id: "y", kind: "saved", list: "l2", on: false },
      { id: "z", kind: "saved", list: "l1", on: false },
    ]);
    expect(loadHomeRows()).toEqual([
      { id: "saved:l1", kind: "saved", list: "l1", on: true, title: "Weekend" },
      { id: "saved:l2", kind: "saved", list: "l2", on: false },
    ]);
    expect(savedId("l1")).toBe("saved:l1");
  });

  it("Saved: a row with no list is dropped", () => {
    put([
      { id: "a", kind: "saved", on: true },
      { id: "b", kind: "saved", list: "", on: true },
      { id: "c", kind: "saved", list: 7, on: true },
      { id: "continue", kind: "continue", on: true },
    ]);
    expect(ids(loadHomeRows()!)).toEqual(["continue"]);
  });

  it("Trakt: the four lists, once each, under an id made from the list", () => {
    put([
      { id: "a", kind: "trakt", list: "trending_movies", on: true },
      { id: "b", kind: "trakt", list: "trending_shows", on: false, title: "Hot" },
      { id: "c", kind: "trakt", list: "popular_movies", on: true },
      { id: "d", kind: "trakt", list: "popular_shows", on: true },
      { id: "e", kind: "trakt", list: "trending_movies", on: false },
    ]);
    expect(loadHomeRows()).toEqual([
      { id: "trakt:trending_movies", kind: "trakt", list: "trending_movies", on: true },
      { id: "trakt:trending_shows", kind: "trakt", list: "trending_shows", on: false, title: "Hot" },
      { id: "trakt:popular_movies", kind: "trakt", list: "popular_movies", on: true },
      { id: "trakt:popular_shows", kind: "trakt", list: "popular_shows", on: true },
    ]);
  });

  it("Trakt: a list that is not one of the four is dropped", () => {
    put([
      { id: "a", kind: "trakt", list: "anticipated_movies", on: true },
      { id: "b", kind: "trakt", on: true },
      { id: "c", kind: "trakt", list: "__proto__", on: true },
      { id: "continue", kind: "continue", on: true },
    ]);
    expect(ids(loadHomeRows()!)).toEqual(["continue"]);
  });

  it("Needs a Source: kept with its id, its title and Strand's row", () => {
    const strand = { id: "S-1", source: { smartList: { _0: "x" } }, title: "Mystery" };
    put([{ id: "needs:S-1", kind: "needs", on: true, title: " Mystery ", strand }]);
    expect(loadHomeRows()).toEqual([{ id: "needs:S-1", kind: "needs", on: true, title: "Mystery", strand }]);
  });

  it("Needs a Source: dropped without an id, a title, or an object of reasonable size", () => {
    const ok = { source: {} };
    put([
      { kind: "needs", on: true, title: "A", strand: ok },
      { id: "needs:b", kind: "needs", on: true, strand: ok },
      { id: "needs:c", kind: "needs", on: true, title: "C" },
      { id: "needs:d", kind: "needs", on: true, title: "D", strand: "text" },
      { id: "needs:e", kind: "needs", on: true, title: "E", strand: [1] },
      { id: "needs:f", kind: "needs", on: true, title: "F", strand: { pad: "x".repeat(STRAND_MAX) } },
      { id: "needs:g", kind: "needs", on: true, title: "G", strand: ok },
    ]);
    expect(ids(loadHomeRows()!)).toEqual(["needs:g"]);
  });

  it("Needs a Source: the cap is on the JSON, and an object that cannot be written is not kept", () => {
    expect(fitsStrand({ a: "x".repeat(STRAND_MAX - 10) })).toBe(true);
    expect(fitsStrand({ a: "x".repeat(STRAND_MAX) })).toBe(false);
    const loop: Record<string, unknown> = {};
    loop.me = loop;
    expect(fitsStrand(loop)).toBe(false);
    expect(fitsStrand(null)).toBe(false);
  });

  it("can all be removed, and are not live rows", () => {
    expect(["saved", "trakt", "needs"].every((k) => removable(k as HomeRowKind))).toBe(true);
    expect(["saved", "trakt", "needs", "continue", "catalog"].some((k) => isLive(k as HomeRowKind))).toBe(false);
    expect(["onnow", "recent", "games", "recordings"].every((k) => isLive(k as HomeRowKind))).toBe(true);
  });

  it("are kept, in order, through a save and a load", () => {
    const rows: HomeRow[] = [
      { id: "continue", kind: "continue", on: true },
      { id: "saved:l1", kind: "saved", list: "l1", on: true },
      { id: "trakt:popular_shows", kind: "trakt", list: "popular_shows", on: false },
      { id: "needs:S-2", kind: "needs", on: true, title: "Spotlight", strand: { source: {} } },
    ];
    saveHomeRows(rows);
    expect(loadHomeRows()).toEqual(rows);
  });
});

describe("the sport rows", () => {
  beforeEach(() => store.clear());

  it("are kept with their sport, under an id made from it, beside Today's Games", () => {
    const rows: HomeRow[] = [
      { id: "games", kind: "games", on: true },
      { id: "games:football", kind: "games", sport: "football", on: true, title: "Sundays" },
      { id: "games:soccer", kind: "games", sport: "soccer", on: false },
    ];
    saveHomeRows(rows);
    expect(loadHomeRows()).toEqual(rows);
  });

  it("hold one sport once, whatever id was stored", () => {
    put([
      { id: "x", kind: "games", sport: "hockey", on: true },
      { id: "games:hockey", kind: "games", sport: "hockey", on: false },
    ]);
    expect(loadHomeRows()).toEqual([{ id: "games:hockey", kind: "games", sport: "hockey", on: true }]);
  });

  it("drop a sport the catalog does not carry, and one that is not a word, rather than become Today's Games", () => {
    put([
      { id: "games:curling", kind: "games", sport: "curling", on: true },
      { id: "g", kind: "games", sport: 4, on: true },
      { id: "games", kind: "games", sport: "", on: true },
      { id: "continue", kind: "continue", on: true },
    ]);
    expect(ids(loadHomeRows()!)).toEqual(["continue"]);
  });

  it("can be removed, are live rows, and do not count as Today's Games having been offered", () => {
    expect(removable("games")).toBe(true);
    expect(isLive("games")).toBe(true);
    const sportOnly: HomeRow[] = [
      { id: "continue", kind: "continue", on: true },
      { id: "games:football", kind: "games", sport: "football", on: true },
    ];
    // A layout holding only a sport row has not been offered Today's Games...
    saveHomeRows(sportOnly);
    expect(loadOffered()).toEqual([]);
    // ...so it still gets it, once, when there is a live source.
    expect(ids(withAutoRows(sportOnly, [], true))).toEqual(["continue", "games:football", "onnow", "games"]);
  });
});

describe("reorderWithin", () => {
  const rows: HomeRow[] = [
    { id: "carousel", kind: "carousel", on: true },
    { id: "continue", kind: "continue", on: true },
    { id: "aio:gone", kind: "catalog", on: true },
    { id: "upnext", kind: "upnext", on: true },
    { id: "aio:b", kind: "catalog", on: true },
  ];

  it("puts the named rows in the new order, in the slots those rows held", () => {
    expect(ids(reorderWithin(rows, ["aio:b", "upnext", "continue"]))).toEqual(["carousel", "aio:b", "aio:gone", "upnext", "continue"]);
  });

  it("leaves a row that was not named (a hidden catalog row, the carousel) exactly where it was", () => {
    const out = reorderWithin(rows, ["aio:b", "upnext", "continue"]);
    expect(out.indexOf(rows[0])).toBe(0);
    expect(out[2]).toBe(rows[2]);
  });

  it("is the same order for the same order", () => {
    expect(ids(reorderWithin(rows, ["continue", "upnext", "aio:b"]))).toEqual(ids(rows));
  });
});
