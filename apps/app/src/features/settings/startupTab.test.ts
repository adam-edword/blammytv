import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: stub the browser global the storage seam reads.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});

import { STARTUP_TABS, loadStartupTab, saveStartupTab } from "./startupTab";

const put = (data: unknown, v = 1) => store.set("blammytv.startupTab", JSON.stringify({ v, data }));

describe("loadStartupTab", () => {
  beforeEach(() => store.clear());

  it("stays Live TV with nothing stored: a changed default would move everyone who never picked", () => {
    expect(loadStartupTab()).toBe("live");
  });

  it("keeps each of the four that can be picked", () => {
    for (const t of STARTUP_TABS) {
      saveStartupTab(t.key);
      expect(loadStartupTab()).toBe(t.key);
    }
  });

  it("falls back to Live TV for anything else", () => {
    put("sports");
    expect(loadStartupTab()).toBe("live");
    put(3);
    expect(loadStartupTab()).toBe("live");
    put("home", 2);
    expect(loadStartupTab()).toBe("live");
  });

  it("lists Home first, as Home, then the rest in the order they were", () => {
    expect(STARTUP_TABS.map((t) => [t.key, t.label])).toEqual([
      ["home", "Home"],
      ["live", "Live TV"],
      ["stream", "Stream"],
      ["discover", "Stream · Discover"],
    ]);
  });
});
