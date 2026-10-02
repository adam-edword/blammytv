import { beforeEach, describe, expect, it, vi } from "vitest";

// Written BEFORE lists.ts exists. Migration is the only irreversible
// failure this feature can produce: a user with saved titles upgrades once,
// and if their list does not survive that single load, it is gone. Every
// other bug here is cosmetic by comparison.

// Same node-env seam as watching.test.ts: vitest runs without a DOM.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

/** The shape lib/storage.ts writes: a versioned envelope. */
const seed = (key: string, version: number, data: unknown) =>
  store.set(`blammytv.${key}`, JSON.stringify({ v: version, data }));

const OLD_ENTRY = (id: string, title: string, at: number) => ({
  id,
  title,
  kind: "movie" as const,
  poster: `${id}.jpg`,
  at,
});

describe("migration from the single My List", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  it("carries every saved title into a default list, in order", async () => {
    seed("myList", 1, [
      OLD_ENTRY("c", "Newest", 300),
      OLD_ENTRY("b", "Middle", 200),
      OLD_ENTRY("a", "Oldest", 100),
    ]);
    const { loadLists } = await import("./lists");
    const lists = loadLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("My List");
    // Order is the grid's order and users notice when it changes.
    expect(lists[0].entries.map((e) => e.id)).toEqual(["c", "b", "a"]);
    // The snapshot fields ride along untouched: they are what paints the
    // card without a network round trip.
    expect(lists[0].entries[0].poster).toBe("c.jpg");
  });

  it("NEVER deletes the old key, so a downgrade still finds its data", async () => {
    seed("myList", 1, [OLD_ENTRY("a", "Kept", 100)]);
    const { loadLists } = await import("./lists");
    loadLists();
    expect(store.get("blammytv.myList")).toBeTruthy();
  });

  it("is idempotent: a second load does not duplicate or re-migrate", async () => {
    seed("myList", 1, [OLD_ENTRY("a", "One", 100)]);
    const m = await import("./lists");
    const first = m.loadLists();
    // Simulate the user renaming the migrated list, then reloading.
    m.renameList(first[0].id, "Renamed");
    const second = m.loadLists();
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe("Renamed");
    expect(second[0].entries).toHaveLength(1);
  });

  it("starts clean for a user who never saved anything", async () => {
    const { loadLists } = await import("./lists");
    expect(loadLists()).toEqual([]);
  });

  it("does not invent a list from an empty old list", async () => {
    seed("myList", 1, []);
    const { loadLists } = await import("./lists");
    expect(loadLists()).toEqual([]);
  });
});

describe("lists", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  const ITEM = {
    id: "x1",
    title: "A Title",
    kind: "movie" as const,
    poster: "p.jpg",
    genres: [],
    cast: [],
    seasons: [],
  };

  it("creates a default list on the first save when none exist", async () => {
    const m = await import("./lists");
    m.addToList(null, ITEM);
    const lists = m.loadLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].entries[0].id).toBe("x1");
  });

  it("survives the user deleting every list", async () => {
    const m = await import("./lists");
    m.addToList(null, ITEM);
    for (const l of m.loadLists()) m.deleteList(l.id);
    expect(m.loadLists()).toEqual([]);
    // The add button must still have somewhere to put things.
    m.addToList(null, ITEM);
    expect(m.loadLists()).toHaveLength(1);
  });

  it("reports membership across ALL lists", async () => {
    const m = await import("./lists");
    const a = m.createList("A");
    const b = m.createList("B");
    m.addToList(a.id, ITEM);
    expect(m.listsContaining("x1").map((l) => l.id)).toEqual([a.id]);
    m.addToList(b.id, ITEM);
    expect(m.listsContaining("x1")).toHaveLength(2);
    // The old yes/no question still answers correctly, so call sites that
    // only ask "is this saved" keep working unchanged.
    expect(m.inAnyList("x1")).toBe(true);
    expect(m.inAnyList("nope")).toBe(false);
  });

  it("does not add the same title to one list twice", async () => {
    const m = await import("./lists");
    const a = m.createList("A");
    m.addToList(a.id, ITEM);
    m.addToList(a.id, ITEM);
    expect(m.loadLists()[0].entries).toHaveLength(1);
  });

  it("newest save lands first", async () => {
    const m = await import("./lists");
    const a = m.createList("A");
    m.addToList(a.id, ITEM);
    m.addToList(a.id, { ...ITEM, id: "x2", title: "Second" });
    expect(m.loadLists()[0].entries.map((e) => e.id)).toEqual(["x2", "x1"]);
  });

  it("snapshots the card fields, leaving absent optionals absent", async () => {
    const m = await import("./lists");
    const a = m.createList("A");
    m.addToList(a.id, { ...ITEM, year: 2020, rating: 8.1 });
    const e = m.loadLists()[0].entries[0];
    expect(e).toMatchObject({ poster: "p.jpg", year: 2020, rating: 8.1 });
    // No undefined keys in storage (inherited from the pre-009 shape).
    expect("runtimeMin" in e).toBe(false);
    expect("logo" in e).toBe(false);
  });

  it("removes a title from one list without touching the others", async () => {
    const m = await import("./lists");
    const a = m.createList("A");
    const b = m.createList("B");
    m.addToList(a.id, ITEM);
    m.addToList(b.id, ITEM);
    m.removeFromList(a.id, "x1");
    expect(m.listsContaining("x1").map((l) => l.id)).toEqual([b.id]);
  });

  it("keeps the list when a cover cannot be stored", async () => {
    const m = await import("./lists");
    const a = m.createList("A");
    // A quota failure must cost the COVER, never the list itself.
    const setItem = localStorage.setItem;
    vi.stubGlobal("localStorage", {
      ...localStorage,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => m.setCover(a.id, "data:image/jpeg;base64,zzz")).not.toThrow();
    vi.stubGlobal("localStorage", { ...localStorage, setItem });
    expect(m.loadLists().find((l) => l.id === a.id)).toBeTruthy();
  });
});

describe("the Trakt Watchlist (plan 015, D2)", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  const ITEM = { id: "x1", title: "A Title", kind: "movie" as const, genres: [], cast: [], seasons: [] };

  it("is made once, at the end, and a plain Save never lands in it", async () => {
    const m = await import("./lists");
    m.ensureTraktList();
    m.ensureTraktList();
    expect(m.loadLists().map((l) => l.id)).toEqual([m.TRAKT_LIST]);
    // With only the Trakt list there, Save makes My List rather than
    // sending the title to Trakt.
    m.addToList(null, ITEM);
    const lists = m.loadLists();
    expect(lists.map((l) => l.name)).toEqual(["Trakt Watchlist", "My List"]);
    expect(lists.find((l) => l.id === m.TRAKT_LIST)!.entries).toEqual([]);
  });

  it("cannot be renamed or deleted by hand, only dropped on disconnect", async () => {
    const m = await import("./lists");
    m.ensureTraktList();
    m.renameList(m.TRAKT_LIST, "Mine");
    m.deleteList(m.TRAKT_LIST);
    expect(m.loadLists().map((l) => l.name)).toEqual(["Trakt Watchlist"]);
    m.dropTraktList();
    expect(m.loadLists()).toEqual([]);
  });

  it("takes Trakt's titles as they come, once each", async () => {
    const m = await import("./lists");
    m.ensureTraktList();
    const e = { id: "tt1", title: "One", kind: "movie" as const, year: 2001, at: 5 };
    m.addEntries(m.TRAKT_LIST, [e]);
    m.addEntries(m.TRAKT_LIST, [e, { ...e, id: "tt2", title: "Two" }]);
    expect(m.loadLists()[0].entries.map((x) => x.id)).toEqual(["tt2", "tt1"]);
  });
});
