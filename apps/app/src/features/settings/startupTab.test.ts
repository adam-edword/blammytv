import { beforeEach, describe, expect, it, vi } from "vitest";

// Node test env: stub the browser global the storage seam reads.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});

import { STARTUP_TABS, loadStartupTab, saveStartupTab, shownStartup, startupChoices } from "./startupTab";

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

describe("startupChoices", () => {
  const keys = (live: boolean, stream: boolean) => startupChoices({ live, stream }).map((t) => t.key);

  it("offers all four with both kinds of source, in the picker's order", () => {
    expect(keys(true, true)).toEqual(STARTUP_TABS.map((t) => t.key));
  });

  it("offers Live TV alone with only a playlist", () => {
    expect(keys(true, false)).toEqual(["live"]);
  });

  it("offers Home, Stream and Discover without Live TV with only a stream source", () => {
    expect(keys(false, true)).toEqual(["home", "stream", "discover"]);
  });

  it("offers nothing with no source", () => {
    expect(keys(false, false)).toEqual([]);
  });
});

describe("shownStartup", () => {
  const stream = startupChoices({ live: false, stream: true });

  it("shows the stored tab when it is on offer", () => {
    expect(shownStartup("discover", stream)).toBe("discover");
  });

  it("shows Stream when the stored tab is not on offer and Stream is, where a launch fell back to before", () => {
    expect(shownStartup("live", stream)).toBe("stream");
  });

  it("shows the first choice when neither the stored tab nor Stream is on offer", () => {
    expect(shownStartup("home", startupChoices({ live: true, stream: false }))).toBe("live");
  });

  it("shows the stored tab when there are no choices at all", () => {
    expect(shownStartup("live", [])).toBe("live");
  });
});
