import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetAioWatched,
  loadAioWatched,
  loadWatched,
  markWatched,
  replaceAioWatched,
  replaceLedger,
  setMalWatched,
} from "./watched";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal("window", { dispatchEvent: () => true });
vi.stubGlobal("CustomEvent", class { constructor(public type: string) {} });

beforeEach(() => localStorage.clear());

describe("a tick shows if any store has it (plan 023, D3)", () => {
  it("is the union of yours, Trakt's, MAL's and AIOStreams'", () => {
    markWatched("tt1", "tt1:1:1"); // yours
    setMalWatched("tt1", ["tt1:1:2"]); // MAL's
    replaceAioWatched({ episodes: { tt1: ["tt1:1:3"], tt2: ["tt2:1:1"] }, films: [] });
    expect([...loadWatched("tt1")].sort()).toEqual(["tt1:1:1", "tt1:1:2", "tt1:1:3"]);
    expect([...loadWatched("tt2")]).toEqual(["tt2:1:1"]);
  });

  it("survives Trakt replacing the ledger, which is why it is stored apart", () => {
    replaceAioWatched({ episodes: { tt1: ["tt1:1:3"] }, films: [] });
    replaceLedger({ tt1: ["tt1:1:1"] });
    expect([...loadWatched("tt1")].sort()).toEqual(["tt1:1:1", "tt1:1:3"]);
  });
});

describe("AIOStreams' played list", () => {
  it("is replaced whole, so un-marking elsewhere un-ticks here", () => {
    replaceAioWatched({ episodes: { tt1: ["tt1:1:1", "tt1:1:2"] }, films: ["tt9"] });
    replaceAioWatched({ episodes: { tt1: ["tt1:1:2"] }, films: [] });
    expect(loadAioWatched()).toEqual({ episodes: { tt1: ["tt1:1:2"] }, films: [] });
  });

  it("says whether a replace changed anything", () => {
    expect(replaceAioWatched({ episodes: {}, films: [] })).toBe(false);
    expect(replaceAioWatched({ episodes: { tt1: ["tt1:1:1"] }, films: [] })).toBe(true);
    expect(replaceAioWatched({ episodes: { tt1: ["tt1:1:1"] }, films: [] })).toBe(false);
  });

  it("goes with the sign-out", () => {
    replaceAioWatched({ episodes: { tt1: ["tt1:1:1"] }, films: ["tt9"] });
    forgetAioWatched();
    expect(loadAioWatched()).toEqual({ episodes: {}, films: [] });
    expect([...loadWatched("tt1")]).toEqual([]);
  });
});
