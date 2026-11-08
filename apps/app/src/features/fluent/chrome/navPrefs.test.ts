import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadNavRail, saveNavRail } from "./navPrefs";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

describe("navPrefs", () => {
  beforeEach(() => mem.clear());

  it("opens on the full pane", () => {
    expect(loadNavRail()).toBe(false);
  });

  it("remembers the rail and the pane", () => {
    saveNavRail(true);
    expect(loadNavRail()).toBe(true);
    saveNavRail(false);
    expect(loadNavRail()).toBe(false);
  });

  it("reads anything but a boolean as the pane", () => {
    mem.set("blammytv.fluentNavRail", JSON.stringify({ v: 1, data: "rail" }));
    expect(loadNavRail()).toBe(false);
  });
});
