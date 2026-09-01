import { describe, expect, it } from "vitest";
import {
  RECENT_KEEP,
  genreCounts,
  pick,
  remember,
  shortlist,
} from "./pick";
import type { VodItem } from "../stream/model";

const item = (
  id: string,
  genres: string[],
  extra: Partial<VodItem> = {},
): VodItem => ({
  id,
  title: id,
  kind: "movie",
  genres,
  cast: [],
  seasons: [],
  ...extra,
});

const POOL = [
  item("a", ["Action", "Comedy"], { rating: 8 }),
  item("b", ["Action"], { rating: 6 }),
  item("c", ["Comedy"], { rating: 9 }),
  item("d", ["Horror"], {}), // no rating at all
  item("e", ["Action", "Comedy"], { rating: 4, kind: "series" }),
];

describe("shortlist", () => {
  it("takes every chosen genre when something has them all", () => {
    const r = shortlist(POOL, { genres: ["Action", "Comedy"] });
    expect(r.mode).toBe("all");
    expect(r.relaxed).toBe(false);
    expect(r.items.map((i) => i.id)).toEqual(["a", "e"]);
  });

  it("relaxes to ANY when the intersection is empty, and says so", () => {
    // Nothing is both Horror and Comedy. Adam's rule: fall back rather
    // than say no, but the caller has to be able to tell the user.
    const r = shortlist(POOL, { genres: ["Horror", "Comedy"] });
    expect(r.mode).toBe("any");
    expect(r.relaxed).toBe(true);
    expect(r.items.map((i) => i.id).sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("is not relaxed when nothing matches either way", () => {
    const r = shortlist(POOL, { genres: ["Documentary"] });
    expect(r.items).toEqual([]);
    expect(r.relaxed).toBe(false);
  });

  it("ignores case and spacing on genre names", () => {
    const r = shortlist(POOL, { genres: ["  action  ", "COMEDY"] });
    expect(r.items.map((i) => i.id)).toEqual(["a", "e"]);
  });

  it("treats no genres as no genre filter", () => {
    expect(shortlist(POOL, { genres: [] }).items).toHaveLength(POOL.length);
  });

  it("drops unrated titles when a star floor is set", () => {
    // "d" has no rating at all and goes: a floor is a promise it cannot
    // keep. "e" goes too, at 4 stars. Everything at or above 5 stays,
    // which includes "b" at exactly 6 — the floor is inclusive.
    const r = shortlist(POOL, { genres: [], minRating: 5 });
    expect(r.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("never relaxes the star floor or the type, only the genres", () => {
    // Horror+Comedy has no intersection, so this relaxes genres — and the
    // 7-star floor still has to hold across the relaxation.
    const r = shortlist(POOL, { genres: ["Horror", "Comedy"], minRating: 7 });
    expect(r.relaxed).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["a", "c"]);
    // "e" is the only series and it is Action+Comedy at 4 stars.
    const s = shortlist(POOL, { genres: ["Action", "Comedy"], kind: "series" });
    expect(s.items.map((i) => i.id)).toEqual(["e"]);
  });
});

describe("pick", () => {
  it("returns null only for an empty pool", () => {
    expect(pick([])).toBeNull();
    expect(pick(POOL, [], () => 0)).toBe(POOL[0]);
  });

  it("uses the injected rng across the range", () => {
    expect(pick(POOL, [], () => 0)?.id).toBe("a");
    expect(pick(POOL, [], () => 0.999)?.id).toBe("e");
  });

  it("never indexes past the end when rng returns exactly 1", () => {
    // Math.random() is documented as < 1, but a caller's rng might not be,
    // and an out-of-range index here returns undefined rather than an item.
    expect(pick(POOL, [], () => 1)).toBe(POOL[POOL.length - 1]);
  });

  it("skips what was just offered", () => {
    const out = pick(POOL, ["a", "b", "c", "d"], () => 0);
    expect(out?.id).toBe("e");
  });

  it("comes back round when everything is recent", () => {
    // Three matching films means the fourth press has to repeat one.
    // Returning null here would read as "no results", which is a lie.
    const all = POOL.map((i) => i.id);
    expect(pick(POOL, all, () => 0)?.id).toBe("a");
  });
});

describe("remember", () => {
  it("puts the newest first and does not duplicate", () => {
    expect(remember(["a", "b"], "b")).toEqual(["b", "a"]);
  });

  it("caps the list", () => {
    let r: string[] = [];
    for (let i = 0; i < RECENT_KEEP + 5; i++) r = remember(r, `id${i}`);
    expect(r).toHaveLength(RECENT_KEEP);
    expect(r[0]).toBe(`id${RECENT_KEEP + 4}`);
  });
});

describe("genreCounts", () => {
  it("counts the POOL, not the manifest", () => {
    // The point: a chip offered from the manifest can match nothing in the
    // pool it is about to draw from.
    const c = genreCounts(POOL);
    expect(c.get("Action")).toBe(3);
    expect(c.get("Comedy")).toBe(3);
    expect(c.get("Horror")).toBe(1);
    expect(c.has("Documentary")).toBe(false);
  });
});
