import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLayoutKinds, saveLayoutKinds } from "./multiviewAck";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("layout choices", () => {
  it("keeps a choice per count", () => {
    saveLayoutKinds({ 2: "grid", 3: "focus" });
    expect(loadLayoutKinds()).toEqual({ 2: "grid", 3: "focus" });
  });

  it("starts over once from a choice saved before Focus was the default (v0.9.124)", () => {
    store.set("blammytv.multiviewLayouts", JSON.stringify({ v: 1, data: { 2: "grid", 4: "grid" } }));
    expect(loadLayoutKinds()).toEqual({});
  });
});
