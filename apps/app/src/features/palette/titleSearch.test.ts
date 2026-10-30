import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VodItem } from "../stream/model";
import { pickTitles, runTitleSearch, TITLE_DELAY_MS, TITLE_ROWS, type TitleAnswer } from "./titleSearch";

const vod = (id: string, from?: VodItem["from"]): VodItem => ({
  id,
  title: `Title ${id}`,
  kind: "movie",
  genres: [],
  cast: [],
  seasons: [],
  ...(from ? { from } : {}),
});

/** A promise settled from outside, so a test decides which answer lands first. */
function held<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { p, resolve, reject };
}

describe("runTitleSearch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits out the pause before it asks, and asks once", async () => {
    const ask = vi.fn(async () => [vod("a")]);
    const done = vi.fn();
    runTitleSearch("la la land", ask, done);
    await vi.advanceTimersByTimeAsync(TITLE_DELAY_MS - 1);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith("la la land");
    expect(done).toHaveBeenCalledWith({ q: "la la land", items: [vod("a")] });
  });

  it("never asks when it is cancelled during the pause", async () => {
    const ask = vi.fn(async () => []);
    const cancel = runTitleSearch("la", ask, vi.fn());
    cancel();
    await vi.advanceTimersByTimeAsync(TITLE_DELAY_MS * 3);
    expect(ask).not.toHaveBeenCalled();
  });

  it("drops a slow answer for an old query when a newer one was asked", async () => {
    const slow = held<VodItem[]>();
    const fast = held<VodItem[]>();
    const ask = vi.fn((q: string) => (q === "la" ? slow.p : fast.p));
    const got: TitleAnswer[] = [];
    const first = runTitleSearch("la", ask, (a) => got.push(a));
    await vi.advanceTimersByTimeAsync(TITLE_DELAY_MS);
    // The query changes while "la" is still out: what the effect's cleanup does.
    first();
    runTitleSearch("la la", ask, (a) => got.push(a));
    await vi.advanceTimersByTimeAsync(TITLE_DELAY_MS);
    fast.resolve([vod("new")]);
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve([vod("old")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([{ q: "la la", items: [vod("new")] }]);
  });

  it("answers with nothing when the ask fails", async () => {
    const ask = vi.fn(async () => {
      throw new Error("offline");
    });
    const done = vi.fn();
    runTitleSearch("la", ask, done);
    await vi.advanceTimersByTimeAsync(TITLE_DELAY_MS);
    expect(done).toHaveBeenCalledWith({ q: "la", items: [] });
  });
});

describe("pickTitles", () => {
  it("lists the first five, in order", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"].map((i) => vod(i));
    expect(pickTitles(items, new Set()).map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(TITLE_ROWS).toBe(5);
  });

  it("leaves out a title the palette already lists, and fills the place from further down", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((i) => vod(i));
    expect(pickTitles(items, new Set(["|b"])).map((i) => i.id)).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("keeps the same id from another source: Discover lists those as two on purpose", () => {
    const items = [vod("a"), vod("a", "jf")];
    expect(pickTitles(items, new Set(["|a"])).map((i) => i.from)).toEqual(["jf"]);
  });
});
