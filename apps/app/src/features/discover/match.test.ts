import { describe, expect, it } from "vitest";
import { broaden, key, rank, score, words } from "./match";

describe("key", () => {
  it("collapses spacing, punctuation and case", () => {
    // The bug that started this: all three are the same title.
    expect(key("Iron Man")).toBe("ironman");
    expect(key("Iron-Man")).toBe("ironman");
    expect(key("ironman")).toBe("ironman");
    expect(key("  IRON   MAN  ")).toBe("ironman");
  });

  it("folds accents, so an English keyboard can reach the title", () => {
    expect(key("Amélie")).toBe("amelie");
    expect(key("Léon: The Professional")).toBe("leontheprofessional");
  });

  it("keeps digits, which carry meaning in a sequel", () => {
    expect(key("Iron Man 2")).toBe("ironman2");
    expect(key("Se7en")).toBe("se7en");
  });
});

describe("words", () => {
  it("splits on anything that is not alphanumeric", () => {
    expect(words("Spider-Man: No Way Home")).toEqual([
      "spider",
      "man",
      "no",
      "way",
      "home",
    ]);
  });
});

describe("score", () => {
  it("matches a run-together query to a spaced title", () => {
    expect(score("Iron Man", "ironman")).toBe(100);
  });

  it("ranks the exact title above its sequel", () => {
    // Both match; the ordering is the point, and it falls out of the tiers
    // rather than a special case.
    expect(score("Iron Man", "ironman")).toBeGreaterThan(
      score("Iron Man 2", "ironman"),
    );
  });

  it("finds a title the query does not lead", () => {
    expect(score("The Dark Knight", "dark knight")).toBeGreaterThan(0);
    expect(score("The Dark Knight", "knight dark")).toBeGreaterThan(0);
  });

  it("matches a typed-ahead prefix of each word", () => {
    expect(score("Harry Potter and the Goblet of Fire", "harr pot")).toBe(40);
  });

  it("scores an unrelated title zero", () => {
    expect(score("The Matrix", "ironman")).toBe(0);
    expect(score("Iron Man", "")).toBe(0);
  });

  it("does not let one shared short word carry a two-word query", () => {
    // "the" hits, "matrix" does not. Without a two-hit floor this scored
    // 20 and searching "the <anything>" returned every title starting
    // "The" — found by this test, fixed in the tier.
    expect(score("The Godfather", "the matrix")).toBe(0);
    expect(score("The Matrix", "the matrix")).toBeGreaterThan(0);
  });
});

describe("rank", () => {
  // `title` is what a VodItem carries, which is what the app ranks.
  const items = [
    { title: "The Matrix" },
    { title: "Iron Man 2" },
    { title: "Iron Man" },
  ];

  it("orders by score and keeps non-matches when not dropping", () => {
    const out = rank(items, "ironman");
    expect(out.map((i) => i.title)).toEqual([
      "Iron Man",
      "Iron Man 2",
      "The Matrix",
    ]);
  });

  it("drops non-matches when asked", () => {
    expect(rank(items, "ironman", true).map((i) => i.title)).toEqual([
      "Iron Man",
      "Iron Man 2",
    ]);
  });

  it("is stable inside a tier, so the catalog interleave survives", () => {
    // Three equal scores: the incoming order has to come back out, or the
    // mix of sources that interleave() built collapses into runs.
    const tie = [
      { title: "Alpha One" },
      { title: "Alpha Two" },
      { title: "Alpha Six" },
    ];
    expect(rank(tie, "alpha").map((i) => i.title)).toEqual([
      "Alpha One",
      "Alpha Two",
      "Alpha Six",
    ]);
  });
});

describe("broaden", () => {
  it("truncates a run-together word to something a substring index can find", () => {
    // THE CONTRACT, not the arithmetic: whatever it returns has to be a
    // prefix of what the user typed AND a substring of the spaced title,
    // because that is the only reason the fallback finds anything. An
    // earlier version asserted the exact cut and failed on a fine answer
    // ("spide"), which tests the divisor rather than the fix.
    for (const [typed, title] of [
      ["ironman", "Iron Man"],
      ["spiderman", "Spider-Man"],
      ["darkknight", "The Dark Knight"],
    ]) {
      const b = broaden(typed);
      expect(b).toBeTruthy();
      expect(typed.startsWith(b as string)).toBe(true);
      expect(title.toLowerCase().includes(b as string)).toBe(true);
    }
  });

  it("refuses when the query is already short", () => {
    expect(broaden("iron")).toBeNull();
    expect(broaden("the")).toBeNull();
  });

  it("refuses a multi-word query, which has a different problem", () => {
    expect(broaden("iron man")).toBeNull();
    expect(broaden("the dark knight")).toBeNull();
  });

  it("never returns something at or below the floor", () => {
    for (const q of ["abcde", "abcdef", "abcdefg", "interstellar"]) {
      const b = broaden(q);
      if (b) expect(b.length).toBeGreaterThanOrEqual(4);
    }
  });
});
