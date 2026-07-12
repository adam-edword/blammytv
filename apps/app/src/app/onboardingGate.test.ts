import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: stub the browser globals the gate reads.
const store = new Map<string, string>();
const workingStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};
vi.stubGlobal("localStorage", workingStorage);
const loc = { search: "" };
vi.stubGlobal("window", { location: loc });

import { markOnboarded, shouldShowOnboarding } from "./onboardingGate";

// v0.4.25 policy: the completed flag is the ONLY suppressor — everyone
// without it (including pre-existing users with sources) walks the
// flow once. Their data survives: steps pre-fill and only ADD.

describe("shouldShowOnboarding", () => {
  beforeEach(() => {
    store.clear();
    loc.search = "";
    vi.stubGlobal("localStorage", workingStorage);
  });

  it("shows on a fresh profile", () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("shows for pre-existing users who never completed it", () => {
    // Sources in storage no longer suppress — the showcase runs once.
    store.set("blammytv.aiostreams", JSON.stringify({ v: 1, data: "x" }));
    store.set("blammytv.playlists", JSON.stringify({ v: 1, data: [{}] }));
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("stays quiet once completed", () => {
    markOnboarded();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("?onboarding=1 forces a replay over the flag", () => {
    markOnboarded();
    loc.search = "?onboarding=1";
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("storage failure fails closed (never shows, never throws)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(shouldShowOnboarding()).toBe(false);
    expect(() => markOnboarded()).not.toThrow();
  });
});
