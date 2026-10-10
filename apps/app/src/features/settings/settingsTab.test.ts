import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: stub the browser global the storage seam reads.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});

import { SETTINGS_PAGES, loadSettingsTab, saveSettingsTab } from "./settingsTab";

const put = (data: unknown, v = 1) => store.set("blammytv.settingsTab", JSON.stringify({ v, data }));

describe("loadSettingsTab", () => {
  beforeEach(() => store.clear());

  it("opens on Sources when nothing is stored", () => {
    expect(loadSettingsTab()).toBe("sources");
  });

  it("opens where it was left, on every page", () => {
    for (const p of SETTINGS_PAGES) {
      saveSettingsTab(p.key);
      expect(loadSettingsTab()).toBe(p.key);
    }
  });

  it("maps the two old tabs to the pages that hold what they held", () => {
    put("general");
    expect(loadSettingsTab()).toBe("sources");
    put("customize");
    expect(loadSettingsTab()).toBe("appearance");
  });

  it("lands on a real page for anything else", () => {
    put("themes");
    expect(loadSettingsTab()).toBe("sources");
    put(7);
    expect(loadSettingsTab()).toBe("sources");
    put("__proto__");
    expect(loadSettingsTab()).toBe("sources");
    put("playback", 2);
    expect(loadSettingsTab()).toBe("sources");
  });

  it("lists the five pages in the order the rail shows them", () => {
    expect(SETTINGS_PAGES.map((p) => p.key)).toEqual(["sources", "playback", "appearance", "accounts", "app"]);
  });
});
