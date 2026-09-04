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
  clearTmdbCache,
  discoverByKeywords,
  findByWords,
  genreIds,
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
  // The genre list is cached for the session, and the session is this
  // whole file.
  clearTmdbCache();
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
    expect(await keywordIds(["space"])).toEqual([
      { id: 9882, name: "space", word: "space" },
    ]);
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

  it("prefers an exact name over their relevance order", async () => {
    // ADAM'S REAL DATA. Searching "horror" returns b-horror FIRST, and
    // b-horror is a different kind of film. On the movie side nothing
    // noticed, because horror is a genre there and never reaches this
    // function; on the TV side there is no Horror genre to catch it, so
    // "space horror" became "space AND b-horror", found nothing, relaxed to
    // OR and answered with twenty Star Treks.
    reply = () => ({
      results: [
        { id: 342626, name: "b-horror" },
        { id: 315058, name: "horror spoof" },
        { id: 9663, name: "horror" },
      ],
    });
    expect(await keywordIds(["horror"])).toEqual([
      { id: 9663, name: "horror", word: "horror" },
    ]);
  });

  it("still takes their first when nothing matches exactly", async () => {
    // The tie-break only breaks ties. A word with no tag of its own name
    // must keep getting their best substring answer rather than nothing.
    reply = () => ({
      results: [
        { id: 342626, name: "b-horror" },
        { id: 315058, name: "horror spoof" },
      ],
    });
    expect(await keywordIds(["horror"])).toEqual([
      { id: 342626, name: "b-horror", word: "horror" },
    ]);
  });

  it("matches an exact name regardless of case or padding", async () => {
    reply = () => ({
      results: [{ id: 1, name: "found footage horror" }, { id: 2, name: "  Horror " }],
    });
    expect(await keywordIds(["horror"])).toEqual([
      { id: 2, name: "Horror", word: "horror" },
    ]);
  });

  it("carries the word that produced it, not just the tag's name", async () => {
    // Their search is a substring match, so a tag's name need not equal
    // what was typed. Deciding "did this word match" by comparing names
    // reported a matched word as unmatched — the app told Adam there was
    // "no tag for horror" while relaxing a two-keyword query, which cannot
    // both be true.
    reply = () => ({ results: [{ id: 999, name: "b horror" }] });
    expect(await keywordIds(["horror"])).toEqual([
      { id: 999, name: "b horror", word: "horror" },
    ]);
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

describe("genres", () => {
  it("are a different vocabulary, and are checked first", async () => {
    // HORROR IS A GENRE THERE, not a keyword. Asking /search/keyword for it
    // returns whatever tag contains the string, which turned "space horror"
    // into "space AND <something tangential>", found nothing, relaxed to
    // OR, and answered with a film that merely has space in it.
    reply = (u) => {
      if (u.includes("/genre/")) return { genres: [{ id: 27, name: "Horror" }] };
      if (u.includes("/search/keyword"))
        return { results: [{ id: 9882, name: "space" }] };
      return { results: [{ id: 348, title: "Alien", release_date: "1979-05-25" }] };
    };
    const r = await findByWords(["space", "horror"], "movie");
    expect(r.genres).toEqual(["horror"]);
    expect(r.keywords.map((k) => k.word)).toEqual(["space"]);
    // The genre never reaches /search/keyword.
    const asks = asked.filter((u) => u.includes("/search/keyword"));
    expect(asks).toHaveLength(1);
    expect(paramsOf(asks[0]).get("query")).toBe("space");
    // And both halves ride the discover call.
    const d = paramsOf(asked.find((u) => u.includes("/discover")) as string);
    expect(d.get("with_keywords")).toBe("9882");
    expect(d.get("with_genres")).toBe("27");
  });

  it("alias sci-fi onto their Science Fiction", async () => {
    reply = () => ({ genres: [{ id: 878, name: "Science Fiction" }] });
    const m = await genreIds("movie");
    expect(m.get("sci-fi")).toBe(878);
    expect(m.get("science fiction")).toBe(878);
  });

  it("a genre-only query still asks discover", async () => {
    reply = (u) =>
      u.includes("/genre/")
        ? { genres: [{ id: 27, name: "Horror" }] }
        : { results: [{ id: 694, title: "The Shining", release_date: "1980-05-23" }] };
    const r = await findByWords(["horror"], "movie");
    expect(r.candidates.map((c) => c.title)).toEqual(["The Shining"]);
    expect(r.unknown).toEqual([]);
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
