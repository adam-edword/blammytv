import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The parsing, against the shapes tmdb.ts believes in.
 *
 * WHAT THIS CANNOT TELL YOU, and it matters more than what it can: whether
 * those shapes are right. api.themoviedb.org is unreachable from this repo,
 * so the fixtures below are written from documentation, and a wrong guess
 * about their JSON passes every check here and still breaks the app. Use
 * `probeTmdb()` on a machine that can reach them for that half.
 *
 * What it does cover is the half that is ours: which request goes out, the
 * first-match rule, the movie/TV field fold, patchy data, and the
 * strict-then-wide fallback.
 */

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

/** Every URL the module asked for, in order. */
const asked: string[] = [];
let reply: (url: string) => unknown = () => ({});

vi.mock("../../lib/http", () => ({
  httpGetText: async (url: string) => {
    asked.push(url);
    return JSON.stringify(reply(url));
  },
}));

const {
  discoverByKeywords,
  findByWords,
  imdbIdFor,
  keywordIds,
  loadTmdbKey,
  saveTmdbKey,
  tmdbEnabled,
} = await import("./tmdb");

const paramsOf = (url: string) => new URL(url).searchParams;

beforeEach(() => {
  store.clear();
  asked.length = 0;
  saveTmdbKey("test-key");
});

describe("the key", () => {
  it("round-trips and gates the feature", () => {
    store.clear();
    expect(tmdbEnabled()).toBe(false);
    saveTmdbKey("  abc  ");
    expect(loadTmdbKey()).toBe("abc");
    expect(tmdbEnabled()).toBe(true);
  });

  it("rides every request", async () => {
    reply = () => ({ results: [{ id: 1, name: "space" }] });
    await keywordIds(["space"]);
    expect(paramsOf(asked[0]).get("api_key")).toBe("test-key");
  });

  it("refuses to ask at all without one", async () => {
    store.clear();
    await expect(keywordIds(["space"])).rejects.toThrow(/no TMDB key/);
    expect(asked).toHaveLength(0);
  });
});

describe("keywordIds", () => {
  it("takes only the first match per word", async () => {
    // Their search is a substring match: "space" also returns "space
    // marine" and "space opera". Folding those in widens the query into
    // something the user did not type.
    reply = () => ({
      results: [
        { id: 9882, name: "space" },
        { id: 14626, name: "space marine" },
        { id: 4379, name: "space opera" },
      ],
    });
    expect(await keywordIds(["space"])).toEqual([{ id: 9882, name: "space" }]);
  });

  it("asks once per word and drops blanks", async () => {
    reply = (u) => ({
      results: [{ id: paramsOf(u).get("query") === "space" ? 1 : 2, name: "x" }],
    });
    await keywordIds(["space", "  ", "horror", ""]);
    expect(asked).toHaveLength(2);
    expect(asked.map((u) => paramsOf(u).get("query"))).toEqual([
      "space",
      "horror",
    ]);
  });

  it("drops a word TMDB has no tag for", async () => {
    reply = () => ({ results: [] });
    expect(await keywordIds(["cosy"])).toEqual([]);
  });
});

describe("discoverByKeywords", () => {
  it("joins with a comma for ALL and a pipe for ANY", async () => {
    // This is their whole AND/OR syntax, and getting it backwards silently
    // returns the wrong films rather than an error.
    reply = () => ({ results: [] });
    await discoverByKeywords([1, 2], "movie", "all");
    expect(paramsOf(asked[0]).get("with_keywords")).toBe("1,2");
    await discoverByKeywords([1, 2], "movie", "any");
    expect(paramsOf(asked[1]).get("with_keywords")).toBe("1|2");
  });

  it("asks the tv endpoint for series and reads its field names", async () => {
    // TV carries name/first_air_date where movies carry
    // title/release_date. One mapper reads both.
    reply = () => ({
      results: [{ id: 1668, name: "Firefly", first_air_date: "2002-09-20" }],
    });
    const out = await discoverByKeywords([9882], "series");
    expect(asked[0]).toContain("/discover/tv");
    expect(out).toEqual([
      { id: "tmdb:series:1668", title: "Firefly", year: 2002, kind: "series" },
    ]);
  });

  it("survives patchy data", async () => {
    reply = () => ({
      results: [
        { id: 62, title: "2001: A Space Odyssey", release_date: "1968-04-02" },
        // No date: the year is absent, not NaN, and the title still counts.
        { id: 999, title: "Untitled", release_date: "" },
        // No title: nothing to search for, so it goes.
        { id: 1000, release_date: "1999-01-01" },
      ],
    });
    const out = await discoverByKeywords([9882], "movie");
    expect(out.map((c) => c.title)).toEqual(["2001: A Space Odyssey", "Untitled"]);
    expect(out[0].year).toBe(1968);
    expect("year" in out[1]).toBe(false);
  });

  it("spends no request on an empty keyword list", async () => {
    expect(await discoverByKeywords([], "movie")).toEqual([]);
    expect(asked).toHaveLength(0);
  });
});

describe("imdbIdFor", () => {
  it("asks the right endpoint per kind and returns the tt id", async () => {
    reply = () => ({ imdb_id: "tt0078748" });
    expect(
      await imdbIdFor({ id: "tmdb:movie:348", title: "Alien", kind: "movie" }),
    ).toBe("tt0078748");
    expect(asked[0]).toContain("/movie/348/external_ids");
    await imdbIdFor({ id: "tmdb:series:1668", title: "Firefly", kind: "series" });
    expect(asked[1]).toContain("/tv/1668/external_ids");
  });

  it("returns null for an unmatched title", async () => {
    // Their field is null for anything they have not matched, and a
    // non-tt value belongs to some other database. Either way there is no
    // addon id to hand on, and pretending otherwise resolves to nothing.
    reply = () => ({ imdb_id: null });
    expect(
      await imdbIdFor({ id: "tmdb:movie:1", title: "x", kind: "movie" }),
    ).toBeNull();
    reply = () => ({ imdb_id: "12345" });
    expect(
      await imdbIdFor({ id: "tmdb:movie:1", title: "x", kind: "movie" }),
    ).toBeNull();
  });
});

describe("findByWords", () => {
  it("takes the strict answer when there is one", async () => {
    reply = (u) =>
      u.includes("/search/keyword")
        ? { results: [{ id: paramsOf(u).get("query") === "space" ? 9882 : 3335, name: paramsOf(u).get("query") }] }
        : { results: [{ id: 348, title: "Alien", release_date: "1979-05-25" }] };
    const r = await findByWords(["space", "horror"], "movie");
    expect(r.relaxed).toBe(false);
    expect(r.candidates.map((c) => c.title)).toEqual(["Alien"]);
    // One discover call, not two: the strict one answered.
    expect(asked.filter((u) => u.includes("/discover")).map((u) => paramsOf(u).get("with_keywords"))).toEqual(["9882,3335"]);
  });

  it("widens to ANY when nothing carries all of them, and says so", async () => {
    reply = (u) => {
      if (u.includes("/search/keyword"))
        return { results: [{ id: paramsOf(u).get("query") === "heist" ? 10051 : 3335, name: paramsOf(u).get("query") }] };
      return paramsOf(u).get("with_keywords")?.includes("|")
        ? { results: [{ id: 694, title: "The Shining", release_date: "1980-05-23" }] }
        : { results: [] };
    };
    const r = await findByWords(["heist", "horror"], "movie");
    expect(r.relaxed).toBe(true);
    expect(r.candidates.map((c) => c.title)).toEqual(["The Shining"]);
  });

  it("does not re-ask a single word as OR", async () => {
    // "all of [x]" and "any of [x]" are the same query. Re-asking spends a
    // request to receive the same empty answer.
    reply = (u) =>
      u.includes("/search/keyword")
        ? { results: [{ id: 9882, name: "space" }] }
        : { results: [] };
    const r = await findByWords(["space"], "movie");
    expect(r.relaxed).toBe(false);
    expect(asked.filter((u) => u.includes("/discover"))).toHaveLength(1);
  });

  it("reports words TMDB has no tag for", async () => {
    reply = (u) =>
      u.includes("/search/keyword")
        ? {
            results:
              paramsOf(u).get("query") === "cosy"
                ? []
                : [{ id: 9882, name: "space" }],
          }
        : { results: [{ id: 62, title: "2001", release_date: "1968-04-02" }] };
    const r = await findByWords(["space", "cosy"], "movie");
    // Silently dropping it would leave the user reading results for a query
    // they did not make, with no clue which half was ignored.
    expect(r.unknown).toEqual(["cosy"]);
    expect(r.keywords.map((k) => k.name)).toEqual(["space"]);
  });

  it("returns nothing rather than everything when no word is known", async () => {
    reply = () => ({ results: [] });
    const r = await findByWords(["cosy"], "movie");
    expect(r.candidates).toEqual([]);
    // An unfiltered /discover would be "here is the whole catalog", which
    // is the worst possible answer to a specific question.
    expect(asked.filter((u) => u.includes("/discover"))).toHaveLength(0);
  });
});
