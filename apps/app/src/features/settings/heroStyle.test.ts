import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: stub the browser global the storage seam reads.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});

import { loadHeroStyle, saveHeroStyle } from "./heroStyle";

describe("heroStyle", () => {
  beforeEach(() => store.clear());

  it("is the shelf with nothing stored", () => {
    expect(loadHeroStyle()).toBe("shelf");
  });

  it("keeps what was saved", () => {
    saveHeroStyle("large");
    expect(loadHeroStyle()).toBe("large");
    saveHeroStyle("shelf");
    expect(loadHeroStyle()).toBe("shelf");
  });

  it("falls back to the shelf for a value it does not know", () => {
    store.set("blammytv.heroStyle", JSON.stringify({ v: 1, data: "wide" }));
    expect(loadHeroStyle()).toBe("shelf");
  });
});
