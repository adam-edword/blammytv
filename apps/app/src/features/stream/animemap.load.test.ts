import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The mapping download's failure memo: a failed fetch is held off for a
// minute (MAL asks every 5s while a watch is past 90%) and then tried again,
// instead of staying failed for the whole session.

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

let fetches = 0;
let up = false;
vi.mock("../../lib/http", () => ({
  httpGetJson: async () => {
    fetches++;
    if (!up) throw new Error("HTTP 503");
    return [{ kitsu_id: 1555, mal_id: 21, imdb_id: "tt0388629", type: "TV" }];
  },
}));

let ensureIndex: typeof import("./animemap").ensureIndex;
let ensureKitsuIndex: typeof import("./animemap").ensureKitsuIndex;

beforeEach(async () => {
  store.clear();
  fetches = 0;
  up = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  // The memos are the module's: start each test with new ones.
  vi.resetModules();
  ({ ensureIndex, ensureKitsuIndex } = await import("./animemap"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a mapping download that fails", () => {
  it("answers nothing, and is not asked again inside a minute", async () => {
    expect(await ensureKitsuIndex()).toBeNull();
    expect(fetches).toBe(1);
    up = true;
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(Date.now() + 10_000);
      expect(await ensureKitsuIndex()).toBeNull();
    }
    // 50s on: still the first failure.
    expect(fetches).toBe(1);
  });

  it("is tried again after a minute, and kept once it works", async () => {
    expect(await ensureKitsuIndex()).toBeNull();
    up = true;
    vi.setSystemTime(Date.now() + 61_000);
    expect(await ensureKitsuIndex()).toEqual({ "1555": 21 });
    expect(fetches).toBe(2);
    vi.setSystemTime(Date.now() + 3600_000);
    expect(await ensureKitsuIndex()).toEqual({ "1555": 21 });
    expect(fetches).toBe(2);
  });

  it("keeps trying once a minute while the download stays down", async () => {
    for (let minute = 0; minute < 3; minute++) {
      expect(await ensureKitsuIndex()).toBeNull();
      vi.setSystemTime(Date.now() + 61_000);
    }
    expect(fetches).toBe(3);
  });

  it("is the same for the IMDb index, and one download feeds both", async () => {
    expect(await ensureIndex()).toBeNull();
    up = true;
    vi.setSystemTime(Date.now() + 61_000);
    expect(await ensureIndex()).toEqual({ tt0388629: [[21, null, 0, "TV"]] });
    expect(await ensureKitsuIndex()).toEqual({ "1555": 21 });
    expect(fetches).toBe(2);
  });
});
