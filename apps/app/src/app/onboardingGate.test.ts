import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAioUrl = vi.fn<() => string>();
const loadPlaylists = vi.fn<() => unknown[]>();
vi.mock("../features/settings/aiostreams", () => ({
  loadAioUrl: () => loadAioUrl(),
}));
vi.mock("../features/settings/playlists", () => ({
  loadPlaylists: () => loadPlaylists(),
}));

// Node test env: stub the browser globals the gate reads.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});
const loc = { search: "" };
vi.stubGlobal("window", { location: loc });

import { markOnboarded, shouldShowOnboarding } from "./onboardingGate";

// The gate must be quiet for everyone who set the app up before
// onboarding existed (they have sources but no flag), and loud only on
// a genuine first run.

describe("shouldShowOnboarding", () => {
  beforeEach(() => {
    store.clear();
    loc.search = "";
    loadAioUrl.mockReturnValue("");
    loadPlaylists.mockReturnValue([]);
  });

  it("shows on a true first run (no flag, no sources)", () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("stays quiet once completed", () => {
    markOnboarded();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("stays quiet for pre-existing AIOStreams users", () => {
    loadAioUrl.mockReturnValue("https://example.com/manifest.json");
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("stays quiet for pre-existing Live TV users", () => {
    loadPlaylists.mockReturnValue([{ id: "p1" }]);
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("?onboarding=1 forces a replay over everything", () => {
    markOnboarded();
    loadAioUrl.mockReturnValue("https://example.com/manifest.json");
    loc.search = "?onboarding=1";
    expect(shouldShowOnboarding()).toBe(true);
  });
});
