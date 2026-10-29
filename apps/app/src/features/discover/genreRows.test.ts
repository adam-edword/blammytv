import { describe, expect, it } from "vitest";
import type { VodItem } from "../stream/model";
import {
  MAX_MIX_ROWS,
  MIN_ROW,
  ROW_MAX,
  buildRows,
  dropOffGenre,
  isOffGenre,
  mixName,
  noteAppearances,
  pinFirst,
  rankCards,
  taggedShare,
  type Appearances,
} from "./genreRows";

const card = (id: string, genres: string[], o: Partial<VodItem> = {}): VodItem => ({
  id,
  title: id,
  kind: "movie",
  genres,
  cast: [],
  seasons: [],
  ...o,
});
const ids = (items: readonly VodItem[]) => items.map((i) => i.id);
/** n cards of Comedy plus `other`, ids `${other}1`.. */
const mix = (other: string, n: number, extra: Partial<VodItem> = {}) =>
  Array.from({ length: n }, (_, i) => card(`${other}${i + 1}`, ["Comedy", other], extra));

describe("noteAppearances", () => {
  it("counts each catalog once and keeps the best place", () => {
    const a: Appearances = new Map();
    const x = card("x", ["Comedy"]);
    noteAppearances(a, "movie:top", 0, [card("w", []), x]); // x is 2nd
    noteAppearances(a, "movie:more", 8, [x]); // and 9th in another
    noteAppearances(a, "movie:more", 16, [x]); // the same catalog again
    expect(a.get("|x")).toEqual({ cats: ["movie:top", "movie:more"], best: 2 });
  });
});

describe("the off-genre drop", () => {
  it("drops a card whose genres are named and leave this one out, case and spaces aside", () => {
    expect(isOffGenre(card("a", ["Horror", "Crime"]), "Comedy")).toBe(true);
    expect(isOffGenre(card("b", [" comedy ", "Crime"]), "Comedy")).toBe(false);
    expect(isOffGenre(card("c", ["COMEDY"]), "comedy")).toBe(false);
  });
  it("keeps a card that names no genres: unknown is not off", () => {
    expect(isOffGenre(card("d", []), "Comedy")).toBe(false);
    expect(isOffGenre(card("e", ["", "  "]), "Comedy")).toBe(false);
  });
  it("filters a list", () => {
    const out = dropOffGenre(
      [card("a", ["Comedy"]), card("b", ["Horror"]), card("c", []), card("d", ["Drama", "comedy"])],
      "Comedy",
    );
    expect(ids(out)).toEqual(["a", "c", "d"]);
  });
});

describe("taggedShare", () => {
  it("is the share of cards with any genre, and 0 for none", () => {
    expect(taggedShare([])).toBe(0);
    expect(taggedShare([card("a", []), card("b", ["Comedy"])])).toBe(0.5);
    expect(taggedShare([card("a", ["", " "])])).toBe(0);
  });
});

describe("rankCards", () => {
  const seen = (entries: Record<string, [number, number]>): Appearances => {
    const m: Appearances = new Map();
    for (const [id, [cats, best]] of Object.entries(entries))
      m.set(`|${id}`, { cats: Array.from({ length: cats }, (_, i) => `c${i}`), best });
    return m;
  };

  it("puts fewest genres first", () => {
    const out = rankCards(
      [card("trio", ["Comedy", "Crime", "Drama"]), card("pair", ["Comedy", "Crime"]), card("solo", ["Comedy"])],
      new Map(),
    );
    expect(ids(out)).toEqual(["solo", "pair", "trio"]);
  });
  it("counts a repeated or blank genre once", () => {
    const out = rankCards([card("a", ["Comedy", "Crime"]), card("b", ["Comedy", "comedy", ""])], new Map());
    expect(ids(out)).toEqual(["b", "a"]);
  });
  it("puts a card with no genres after every card that has some", () => {
    const out = rankCards([card("none", []), card("trio", ["A", "B", "C"])], seen({ none: [5, 1] }));
    expect(ids(out)).toEqual(["trio", "none"]);
  });
  it("then the most catalogs", () => {
    const out = rankCards(
      [card("one", ["Comedy"]), card("three", ["Comedy"]), card("two", ["Comedy"])],
      seen({ one: [1, 1], two: [2, 9], three: [3, 9] }),
    );
    expect(ids(out)).toEqual(["three", "two", "one"]);
  });
  it("then the best place", () => {
    const out = rankCards(
      [card("late", ["Comedy"]), card("early", ["Comedy"]), card("mid", ["Comedy"])],
      seen({ late: [2, 30], early: [2, 1], mid: [2, 9] }),
    );
    expect(ids(out)).toEqual(["early", "mid", "late"]);
  });
  it("then the rating, with no rating last", () => {
    const out = rankCards(
      [card("none", ["Comedy"]), card("low", ["Comedy"], { rating: 5 }), card("high", ["Comedy"], { rating: 8 })],
      seen({ none: [1, 1], low: [1, 1], high: [1, 1] }),
    );
    expect(ids(out)).toEqual(["high", "low", "none"]);
  });
  it("then the order it came in", () => {
    const a = seen({ a: [1, 1], b: [1, 1], c: [1, 1] });
    expect(ids(rankCards([card("c", ["X"]), card("a", ["X"]), card("b", ["X"])], a))).toEqual(["c", "a", "b"]);
  });
  it("lets an earlier tier win over a later one", () => {
    // Fewer genres beats more catalogs, more catalogs beats a better place.
    const out = rankCards(
      [card("popular", ["Comedy", "Crime"]), card("pure", ["Comedy"])],
      seen({ popular: [4, 1], pure: [1, 50] }),
    );
    expect(ids(out)).toEqual(["pure", "popular"]);
  });
});

describe("pinFirst", () => {
  it("moves one card to the front and leaves the rest alone", () => {
    const l = [card("a", []), card("b", []), card("c", [])];
    expect(ids(pinFirst(l, "c"))).toEqual(["c", "a", "b"]);
    expect(ids(pinFirst(l, "zz"))).toEqual(["a", "b", "c"]);
    expect(ids(pinFirst(l, null))).toEqual(["a", "b", "c"]);
  });
});

describe("mixName", () => {
  it("says the pairs the way people do for Comedy", () => {
    expect(mixName("Comedy", "Romance")).toBe("Romantic Comedy");
    expect(mixName("Comedy", "Action")).toBe("Action Comedy");
    expect(mixName("Comedy", "Horror")).toBe("Horror Comedy");
    expect(mixName("Comedy", "Animation")).toBe("Animated Comedy");
    expect(mixName("Comedy", "Crime")).toBe("Crime Comedy");
    expect(mixName("Comedy", "Family")).toBe("Family Comedy");
    expect(mixName("Comedy", "Drama")).toBe("Comedy Drama");
  });
  it("names the pairs a Comedy page grows from real catalogs", () => {
    const names: Record<string, string> = {
      Anime: "Anime Comedy",
      Fantasy: "Fantasy Comedy",
      Adventure: "Adventure Comedy",
      "Science Fiction": "Sci-Fi Comedy",
      "Sci-Fi": "Sci-Fi Comedy",
      Mystery: "Mystery Comedy",
      Sport: "Sports Comedy",
      Sports: "Sports Comedy",
      Musical: "Musical Comedy",
      Music: "Musical Comedy",
      War: "War Comedy",
      History: "Historical Comedy",
      Western: "Western Comedy",
      Thriller: "Comedy Thriller",
    };
    for (const [other, name] of Object.entries(names)) expect(mixName("Comedy", other), other).toBe(name);
    expect(mixName("Documentary", "History")).toBe("Historical Documentary");
    expect(mixName("Horror", "Anime")).toBe("Horror and Anime");
  });
  it("uses the other genre's own casing and the picked genre's", () => {
    expect(mixName("Comedy", " romance ")).toBe("Romantic Comedy");
    expect(mixName("Comedy", "Biography")).toBe("Comedy and Biography");
  });
  it("only puts an adjective in front of a genre that works as the noun", () => {
    expect(mixName("Drama", "Crime")).toBe("Crime Drama");
    expect(mixName("Drama", "Comedy")).toBe("Comedy Drama");
    expect(mixName("Thriller", "Action")).toBe("Action Thriller");
    // Horror is not a noun to hang "Romantic" on.
    expect(mixName("Horror", "Romance")).toBe("Horror and Romance");
    expect(mixName("Action", "Comedy")).toBe("Action and Comedy");
  });
});

describe("buildRows", () => {
  const none: Appearances = new Map();
  const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

  it("makes Just, Series and the mixes, in that order, and leaves off-genre and untagged cards out of every row", () => {
    const pool = [
      card("pure1", ["Comedy"]),
      card("pure2", ["Comedy"]),
      card("show", ["Comedy"], { kind: "series" }),
      ...mix("Romance", MIN_ROW),
      card("horror", ["Horror", "Crime"]), // off-genre
      card("blank", []), // unknown
    ];
    const rows = buildRows(pool, "Comedy", "all", none);
    expect(titles(rows)).toEqual(["Just Comedy", "Comedy Series", "Romantic Comedy"]);
    const inRows = new Set(rows.flatMap((r) => ids(r.all)));
    expect(inRows.has("horror")).toBe(false);
    expect(inRows.has("blank")).toBe(false);
    expect(ids(rows[0].all).sort()).toEqual(["pure1", "pure2", "show"]);
    expect(ids(rows[1].all)).toEqual(["show"]);
  });

  it("makes a mix row at MIN_ROW cards and not one fewer", () => {
    const six = buildRows([card("p", ["Comedy"]), ...mix("Horror", MIN_ROW)], "Comedy", "movie", none);
    expect(titles(six)).toContain("Horror Comedy");
    const five = buildRows([card("p", ["Comedy"]), ...mix("Horror", MIN_ROW - 1)], "Comedy", "movie", none);
    expect(titles(five)).toEqual(["Just Comedy"]);
  });

  it("orders the mixes by card count, and stops at MAX_MIX_ROWS", () => {
    const others = ["Romance", "Action", "Horror", "Crime", "Family", "Animation", "Mystery", "Western"];
    // Romance has the most cards (14), Western the fewest (7): eight qualify.
    const pool = [card("p", ["Comedy"]), ...others.flatMap((o, i) => mix(o, 6 + others.length - i))];
    const rows = buildRows(pool, "Comedy", "movie", none);
    const mixes = rows.filter((r) => r.id.startsWith("mix:"));
    expect(mixes).toHaveLength(MAX_MIX_ROWS);
    expect(mixes.map((r) => r.id)).toEqual(
      others.slice(0, MAX_MIX_ROWS).map((o) => `mix:${o.toLowerCase()}`),
    );
  });

  it("has no Series row unless the type filter is Any", () => {
    const pool = [card("show", ["Comedy"], { kind: "series" }), card("film", ["Comedy"])];
    expect(titles(buildRows(pool, "Comedy", "all", none))).toContain("Comedy Series");
    expect(titles(buildRows(pool, "Comedy", "movie", none))).not.toContain("Comedy Series");
    expect(titles(buildRows(pool, "Comedy", "series", none))).not.toContain("Comedy Series");
  });

  it("ranks every row", () => {
    const pool = [card("trio", ["Comedy", "Romance", "Drama"]), ...mix("Romance", MIN_ROW - 1), card("solo", ["Comedy"])];
    const a: Appearances = new Map();
    const rows = buildRows(pool, "Comedy", "movie", a);
    expect(rows.map((r) => r.id)).toEqual(["just", "mix:romance"]);
    expect(rows[1].all[rows[1].all.length - 1].id).toBe("trio"); // three genres, last
  });

  it("puts a card in one mix: its first other genre", () => {
    // The trio would be the sixth card of both rows. It goes to Romance, so
    // Drama is left with five and has no row.
    const pool = [card("trio", ["Comedy", "Romance", "Drama"]), ...mix("Romance", MIN_ROW - 1), ...mix("Drama", MIN_ROW - 1)];
    const rows = buildRows(pool, "Comedy", "movie", none);
    expect(rows.map((r) => r.id)).toEqual(["mix:romance"]);
    expect(ids(rows[0].all)).toContain("trio");
  });

  it("deals Anime first, skips tags that are not genres, and leaves a card with no genre out of every mix", () => {
    const anime = Array.from({ length: MIN_ROW }, (_, i) => card(`an${i}`, ["Animation", "Comedy", "Anime", "Action"]));
    const reality = Array.from({ length: MIN_ROW }, (_, i) => card(`re${i}`, ["Reality", "Comedy", "Romance"]));
    const only = card("only", ["Game Show", "Comedy"]);
    const rows = buildRows([...anime, ...reality, only], "Comedy", "movie", none);
    expect(rows.map((r) => r.title)).toEqual(["Anime Comedy", "Romantic Comedy"]);
    expect(ids(rows[0].all).sort()).toEqual(ids(anime).sort());
    expect(ids(rows[1].all).sort()).toEqual(ids(reality).sort());
  });

  it("shows TMDB's row first, from TMDB, with at least MIN_ROW titles", () => {
    const popular = Array.from({ length: 25 }, (_, i) => card(`tt${i}`, ["Comedy"]));
    const rows = buildRows([card("p", ["Comedy"])], "Comedy", "all", none, { tmdb: popular });
    expect(rows[0]).toMatchObject({ id: "tmdb", title: "Popular Comedy", from: "TMDB" });
    expect(rows[0].all).toHaveLength(20);
    expect(ids(rows[0].all)).toEqual(ids(popular).slice(0, 20)); // TMDB's order, not ours
    const few = buildRows([card("p", ["Comedy"])], "Comedy", "all", none, { tmdb: popular.slice(0, MIN_ROW - 1) });
    expect(few.map((r) => r.id)).toEqual(["just"]);
  });

  it("hands every row's cards over, and the screen shows the first ROW_MAX", () => {
    const pool = Array.from({ length: ROW_MAX + 5 }, (_, i) => card(`c${i}`, ["Comedy"]));
    expect(buildRows(pool, "Comedy", "movie", none)[0].all).toHaveLength(ROW_MAX + 5);
  });

  it("leads the first row that holds the pinned title with it", () => {
    const pool = [card("a", ["Comedy"]), card("b", ["Comedy"]), card("pin", ["Comedy"])];
    const rows = buildRows(pool, "Comedy", "movie", none, { pin: "pin" });
    expect(ids(rows[0].all)[0]).toBe("pin");
    const other = buildRows(pool, "Comedy", "all", none, { pin: "nowhere" });
    expect(ids(other[0].all)).toEqual(["a", "b", "pin"]);
  });

  it("builds no rows at all when fewer than half the pool carries genres", () => {
    const tagged = (n: number) => Array.from({ length: n }, (_, i) => card(`t${i}`, ["Comedy"]));
    const blank = (n: number) => Array.from({ length: n }, (_, i) => card(`b${i}`, []));
    const popular = tagged(8);
    // Exactly half is enough; one under is not, TMDB's row included.
    expect(buildRows([...tagged(5), ...blank(5)], "Comedy", "all", none).length).toBeGreaterThan(0);
    expect(buildRows([...tagged(4), ...blank(5)], "Comedy", "all", none, { tmdb: popular })).toEqual([]);
    expect(buildRows([], "Comedy", "all", none)).toEqual([]);
  });
});
