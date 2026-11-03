import { beforeEach, describe, expect, it, vi } from "vitest";

// The node-env seam again (see upNext.test.ts): localStorage stood in for.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

import type { Programme } from "./model";
import { airing, loadShape, saveShape, stepFrom, timeLeft, windowAround, wrap } from "./miniGuideModel";

const MIN = 60_000;
const at = (min: number) => new Date(Date.UTC(2026, 10, 3, 20, 0) + min * MIN);
const prog = (title: string, from: number, to: number): Programme => ({
  title,
  start: at(from),
  end: at(to),
});

describe("wrap and stepFrom", () => {
  it("wraps both ways round a list", () => {
    expect(wrap(4, 1, 5)).toBe(0);
    expect(wrap(0, -1, 5)).toBe(4);
    expect(wrap(2, 1, 5)).toBe(3);
  });

  it("goes to the first going down and the last going up from a channel that is not listed", () => {
    expect(stepFrom(-1, 1, 5)).toBe(0);
    expect(stepFrom(-1, -1, 5)).toBe(4);
    expect(stepFrom(1, 1, 5)).toBe(2);
    expect(stepFrom(4, 1, 5)).toBe(0);
  });
});

describe("windowAround", () => {
  it("is radius either side of the selection", () => {
    expect(windowAround(100, 50, 8)).toEqual([42, 59]);
  });

  it("is pulled in at the ends, and never longer than the list", () => {
    expect(windowAround(100, 0, 8)).toEqual([0, 9]);
    expect(windowAround(100, 99, 8)).toEqual([91, 100]);
    expect(windowAround(5, 2, 8)).toEqual([0, 5]);
  });

  it("holds a folder of thousands to a screenful", () => {
    const [from, to] = windowAround(20_000, 12_345, 8);
    expect(to - from).toBe(17);
  });

  it("is empty for an empty list, and clamps a selection past the end", () => {
    expect(windowAround(0, 0, 8)).toEqual([0, 0]);
    expect(windowAround(10, 99, 2)).toEqual([7, 10]);
  });
});

describe("timeLeft", () => {
  it("says minutes under an hour", () => {
    expect(timeLeft(34 * MIN)).toBe("34 min left");
    expect(timeLeft(59 * MIN)).toBe("59 min left");
  });

  it("says hours and minutes, and the hours alone on the hour", () => {
    expect(timeLeft(66 * MIN)).toBe("1 hr 6 min left");
    expect(timeLeft(60 * MIN)).toBe("1 hr left");
    expect(timeLeft(120 * MIN)).toBe("2 hr left");
  });

  it("rounds a part minute up and never says 0", () => {
    expect(timeLeft(33 * MIN + 1)).toBe("34 min left");
    expect(timeLeft(10_000)).toBe("1 min left");
    expect(timeLeft(0)).toBe("1 min left");
  });
});

describe("airing", () => {
  const list = [prog("A", -60, 0), prog("B", 0, 30), prog("C", 30, 90)];

  it("finds what is on and what comes after", () => {
    const a = airing(list, at(10));
    expect(a.now?.title).toBe("B");
    expect(a.next?.title).toBe("C");
  });

  it("counts a programme as over at its end, and the next as on from its start", () => {
    expect(airing(list, at(30)).now?.title).toBe("C");
  });

  it("has no next after the last, and nothing for a channel with no guide", () => {
    expect(airing(list, at(60)).next).toBeUndefined();
    expect(airing([], at(0))).toEqual({ now: undefined, next: undefined });
  });

  it("skips a gap: nothing on, and the next is the one that starts", () => {
    const gap = [prog("A", -60, -30), prog("B", 10, 40)];
    const a = airing(gap, at(0));
    expect(a.now).toBeUndefined();
    expect(a.next?.title).toBe("B");
  });
});

describe("the remembered shape", () => {
  beforeEach(() => store.clear());

  it("is the strip until the list is chosen, and remembers it", () => {
    expect(loadShape()).toBe("strip");
    saveShape("list");
    expect(loadShape()).toBe("list");
    saveShape("strip");
    expect(loadShape()).toBe("strip");
  });

  it("reads anything it does not know as the strip", () => {
    store.set("blammytv.miniGuide", JSON.stringify({ v: 1, data: "grid" }));
    expect(loadShape()).toBe("strip");
  });
});
