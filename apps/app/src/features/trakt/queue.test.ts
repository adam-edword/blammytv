import { beforeEach, describe, expect, it, vi } from "vitest";
import { keepsStop } from "./scrobble";
import { dropFromQueue, forgetCount, forgetTrakt, loadQueue, queueWatch, settled } from "./store";

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

describe("which of Trakt's answers keep a watch queued", () => {
  it("settles on a 2xx, and on the answers that will never change", () => {
    for (const status of [200, 201, 204, 404, 409, 422]) expect(settled(status), String(status)).toBe(true);
  });

  it("keeps the watch for a 401, 403 or 408, which the old rule dropped", () => {
    for (const status of [401, 403, 408]) expect(settled(status), String(status)).toBe(false);
  });

  it("keeps it for the answers it always kept, and for the rest", () => {
    for (const status of [429, 500, 502, 503, 504, 400, 420, 423, 300, 0]) expect(settled(status), String(status)).toBe(false);
  });
});

describe("the live stop queues on the same rule", () => {
  it("queues a finished watch for no answer, and for anything Trakt did not settle", () => {
    expect(keepsStop(null, 95)).toBe(true);
    for (const status of [401, 403, 408, 429, 500, 503]) expect(keepsStop({ status }, 95), String(status)).toBe(true);
  });

  it("does not queue what Trakt settled", () => {
    for (const status of [200, 201, 404, 409, 422]) expect(keepsStop({ status }, 95), String(status)).toBe(false);
  });

  it("queues only a watch past 80%", () => {
    expect(keepsStop(null, 80)).toBe(false);
    expect(keepsStop({ status: 403 }, 80)).toBe(false);
    expect(keepsStop({ status: 403 }, 80.5)).toBe(true);
  });
});
