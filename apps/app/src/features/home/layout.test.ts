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
  onHomeRowsChange,
  saveHomeRows,
  seedHomeRows,
  withNewCatalogRows,
  type HomeRow,
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
      { id: "x", kind: "onnow", on: true },
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
