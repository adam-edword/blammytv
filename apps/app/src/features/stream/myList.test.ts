import { beforeEach, describe, expect, it, vi } from "vitest";
import { inMyList, loadMyList, toggleMyList } from "./myList";
import type { VodItem } from "./model";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const item = (id: string, over: Partial<VodItem> = {}): VodItem => ({
  id,
  title: `Title ${id}`,
  kind: "movie",
  genres: [],
  cast: [],
  seasons: [],
  ...over,
});

beforeEach(() => store.clear());

describe("myList", () => {
  it("toggles on and off, reporting the new state", () => {
    expect(toggleMyList(item("tt1"))).toBe(true);
    expect(inMyList("tt1")).toBe(true);
    expect(toggleMyList(item("tt1"))).toBe(false);
    expect(inMyList("tt1")).toBe(false);
    expect(loadMyList()).toEqual([]);
  });

  it("keeps newest saves first and snapshots card fields", () => {
    toggleMyList(item("tt1", { poster: "http://h/p1.jpg", year: 2020 }));
    toggleMyList(item("tt2", { kind: "series", rating: 8.1 }));
    const list = loadMyList();
    expect(list.map((e) => e.id)).toEqual(["tt2", "tt1"]);
    expect(list[1]).toMatchObject({ poster: "http://h/p1.jpg", year: 2020 });
    expect(list[0]).toMatchObject({ kind: "series", rating: 8.1 });
    // Absent optionals stay absent — no undefined keys in storage.
    expect("runtimeMin" in list[0]).toBe(false);
  });
});
