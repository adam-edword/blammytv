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
  removable,
  saveHomeRows,
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

  it("are the only kinds that can be removed", () => {
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
