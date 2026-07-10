import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadWatching,
  recordWatching,
  resumePoint,
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
