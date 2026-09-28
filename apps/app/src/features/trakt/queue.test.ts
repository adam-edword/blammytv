import { beforeEach, describe, expect, it, vi } from "vitest";
import { dropFromQueue, forgetCount, forgetTrakt, loadQueue, queueWatch } from "./store";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const watch = (imdb: string) => ({ movies: [{ ids: { imdb } }] });

describe("the queue of watches Trakt has not taken yet", () => {
  beforeEach(() => localStorage.clear());

  it("drops only what was sent, so one queued meanwhile stays", () => {
    queueWatch(watch("tt1"));
    queueWatch(watch("tt2"));
    const sending = loadQueue();
    // While those were on their way, another watch finished and queued.
    queueWatch(watch("tt3"));
    dropFromQueue(sending);
    expect(loadQueue()).toEqual([watch("tt3")]);
  });

  it("drops one copy per sent entry", () => {
    queueWatch(watch("tt1"));
    queueWatch(watch("tt1"));
    dropFromQueue([watch("tt1")]);
    expect(loadQueue()).toEqual([watch("tt1")]);
  });

  it("a sign-out moves the count a sync checks against", () => {
    const before = forgetCount();
    forgetTrakt();
    expect(forgetCount()).toBe(before + 1);
  });
});
