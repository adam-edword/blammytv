import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadWatching,
  recordWatching,
  resumePoint,
  retiredFromContinue,
  updateWatchingProgress,
  type WatchEntry,
} from "./watching";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const entry = (over: Partial<WatchEntry>): WatchEntry => ({
  id: "tt1",
  title: "Movie",
  at: 1,
  ...over,
});

beforeEach(() => store.clear());

describe("retiredFromContinue", () => {
  it("retires finished movies, keeps everything else", () => {
    // Movie ≥90% → retired from the CW row.
    expect(retiredFromContinue(entry({ posSec: 5400, durSec: 5700 }))).toBe(
      true,
    );
    // Movie mid-way → stays.
    expect(retiredFromContinue(entry({ posSec: 1200, durSec: 5700 }))).toBe(
      false,
    );
    // Series entry (even a finished episode) → stays; smart resume
    // rolls it to the next episode instead.
    expect(
      retiredFromContinue(
        entry({ episodeId: "tt1:1:2", posSec: 5400, durSec: 5700 }),
      ),
    ).toBe(false);
    // No clocks yet → stays.
    expect(retiredFromContinue(entry({}))).toBe(false);
  });
});

describe("resumePoint", () => {
  it("resumes a meaningful position, rewound a few seconds", () => {
    expect(resumePoint(entry({ posSec: 600, durSec: 6000 }))).toBe(597);
  });
  it("starts over when barely started or effectively finished", () => {
    expect(resumePoint(entry({ posSec: 45 }))).toBeUndefined();
    expect(resumePoint(entry({ posSec: 5900, durSec: 6000 }))).toBeUndefined();
    expect(resumePoint(undefined)).toBeUndefined();
    expect(resumePoint(entry({}))).toBeUndefined();
  });
  it("only resumes the SAME episode of a series", () => {
    const e = entry({ episodeId: "tt1:1:4", posSec: 600, durSec: 2400 });
    expect(resumePoint(e, "tt1:1:4")).toBe(597);
    expect(resumePoint(e, "tt1:1:5")).toBeUndefined();
  });
  it("trusts a long position even without a known duration", () => {
    expect(resumePoint(entry({ posSec: 600 }))).toBe(597);
  });
});

describe("updateWatchingProgress", () => {
  it("updates position in place without reordering", () => {
    recordWatching(entry({ id: "a", at: 1 }));
    recordWatching(entry({ id: "b", at: 2 }));
    const list = updateWatchingProgress("a", 120, 6000);
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(list[1]).toMatchObject({ posSec: 120, durSec: 6000 });
    expect(loadWatching()[1].posSec).toBe(120);
  });
});
