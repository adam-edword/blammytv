import { describe, expect, it } from "vitest";
import { mergeWatchlist, type Snapshot } from "./merge";

const at = (entries: [string, number][]) => new Map(entries);
const sorted = (p: ReturnType<typeof mergeWatchlist>) => ({
  addRemote: [...p.addRemote].sort(),
  removeRemote: [...p.removeRemote].sort(),
  addLocal: [...p.addLocal].sort(),
  removeLocal: [...p.removeLocal].sort(),
  final: [...p.final].sort(),
});
const base: Snapshot = { ids: ["tt1", "tt2"], at: 1000 };

describe("mergeWatchlist (plan 015, D3)", () => {
  it("first sync is the union, each side sent what it lacks", () => {
    const p = mergeWatchlist(null, at([["tt1", 1], ["tt2", 1]]), at([["tt2", 1], ["tt3", 1]]));
    expect(sorted(p)).toEqual({
      addRemote: ["tt1"],
      removeRemote: [],
      addLocal: ["tt3"],
      removeLocal: [],
      final: ["tt1", "tt2", "tt3"],
    });
  });

  it("nothing changed, nothing to do", () => {
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 1]]), at([["tt1", 1], ["tt2", 1]]));
    expect(sorted(p)).toEqual({ addRemote: [], removeRemote: [], addLocal: [], removeLocal: [], final: ["tt1", "tt2"] });
  });

  it("added here since the last sync goes to Trakt", () => {
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 1], ["tt9", 2000]]), at([["tt1", 1], ["tt2", 1]]));
    expect(p.addRemote).toEqual(["tt9"]);
    expect(p.final.sort()).toEqual(["tt1", "tt2", "tt9"]);
  });

  it("added on Trakt since the last sync comes here", () => {
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 1]]), at([["tt1", 1], ["tt2", 1], ["tt9", 2000]]));
    expect(p.addLocal).toEqual(["tt9"]);
  });

  it("removed here since the last sync is removed from Trakt", () => {
    const p = mergeWatchlist(base, at([["tt1", 1]]), at([["tt1", 1], ["tt2", 1]]));
    expect(p.removeRemote).toEqual(["tt2"]);
    expect(p.final).toEqual(["tt1"]);
  });

  it("removed on Trakt since the last sync is removed here", () => {
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 1]]), at([["tt1", 1]]));
    expect(p.removeLocal).toEqual(["tt2"]);
    expect(p.final).toEqual(["tt1"]);
  });

  it("removed on Trakt but saved here again after the last sync is kept", () => {
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 5000]]), at([["tt1", 1]]));
    expect(p.addRemote).toEqual(["tt2"]);
    expect(p.removeLocal).toEqual([]);
    expect(p.final.sort()).toEqual(["tt1", "tt2"]);
  });

  it("removed here but listed on Trakt again after the last sync is kept", () => {
    const p = mergeWatchlist(base, at([["tt1", 1]]), at([["tt1", 1], ["tt2", 5000]]));
    expect(p.addLocal).toEqual(["tt2"]);
    expect(p.removeRemote).toEqual([]);
  });

  it("removed on both sides is simply gone", () => {
    const p = mergeWatchlist(base, at([["tt1", 1]]), at([["tt1", 1]]));
    expect(sorted(p)).toEqual({ addRemote: [], removeRemote: [], addLocal: [], removeLocal: [], final: ["tt1"] });
  });

  it("added on both sides is kept once, sent nowhere", () => {
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 1], ["tt9", 2000]]), at([["tt1", 1], ["tt2", 1], ["tt9", 3000]]));
    expect(p.addRemote).toEqual([]);
    expect(p.addLocal).toEqual([]);
    expect(p.final).toContain("tt9");
  });

  it("a title Trakt refused last time (not agreed) is offered again", () => {
    // tt9 was saved here long ago, never made it to Trakt (a free cap), so
    // it is not in the agreed copy: it is still "only here and new".
    const p = mergeWatchlist(base, at([["tt1", 1], ["tt2", 1], ["tt9", 1]]), at([["tt1", 1], ["tt2", 1]]));
    expect(p.addRemote).toEqual(["tt9"]);
  });
});
