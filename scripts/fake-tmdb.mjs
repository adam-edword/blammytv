// A stand-in for api.themoviedb.org, serving the two endpoints the
// recommender uses in the shape tmdb.ts expects.
//
// READ THE CAVEAT IN tmdb.ts FIRST. api.themoviedb.org is unreachable from
// this repo's dev container (the egress proxy answers 403 to CONNECT), so
// these payloads are written from documentation rather than captured from a
// real response. That makes anything built on this file a test of OUR
// PARSING, not of their API: if TMDB's shape differs, every check here still
// passes and the app still breaks. `probeTmdb()` in tmdb.ts is the one-call
// confirmation, and it has to be run somewhere that can reach them.
//
// Where the fixture is deliberately awkward, it is to catch a specific
// mistake, and each one says which.
//
//   node scripts/fake-tmdb.mjs        # :8086

import http from "node:http";

const PORT = 8086;

/** Keyword search is a SUBSTRING match on their side. "space" really does
 * return "space marine" and "space opera" alongside it, which is why
 * keywordIds takes only the first: folding them all in turns "space" into
 * a much vaguer query than the user typed. Ordered so a naive
 * take-everything implementation produces visibly wrong ids. */
const KEYWORDS = {
  space: [
    { id: 9882, name: "space" },
    { id: 14626, name: "space marine" },
    { id: 4379, name: "space opera" },
  ],
  horror: [{ id: 3335, name: "horror" }],
  heist: [{ id: 10051, name: "heist" }],
  // A word with no tag at all: findByWords has to report it as unknown
  // rather than silently dropping it.
  cosy: [],
};

/** Titles per keyword-id query. The key is the raw with_keywords value, so
 * AND ("9882,3335") and OR ("9882|3335") are different rows — which is what
 * makes the strict-then-wide fallback testable rather than assumed. */
const MOVIES = {
  // space AND horror: the strict answer.
  "9882,3335": [
    { id: 348, title: "Alien", release_date: "1979-05-25" },
    { id: 607, title: "Event Horizon", release_date: "1997-08-15" },
  ],
  // heist AND horror: nothing has both, so `all` comes back empty and the
  // caller must re-ask with OR. Absent on purpose.
  // heist OR horror: the relaxed answer.
  "10051|3335": [
    { id: 500, title: "Reservoir Dogs", release_date: "1992-09-02" },
    { id: 694, title: "The Shining", release_date: "1980-05-23" },
  ],
  "9882": [
    { id: 62, title: "2001: A Space Odyssey", release_date: "1968-04-02" },
    // NO release_date. Their data is patchy and a missing year must not
    // become NaN or drop the title.
    { id: 999, title: "Untitled Space Thing", release_date: "" },
    // No title at all: has to be dropped rather than rendered blank.
    { id: 1000, release_date: "1999-01-01" },
  ],
};

/** TV results use `name` and `first_air_date` instead of title/release_date.
 * One mapper reads both; if it only read the movie fields this returns
 * nothing and the series filter looks broken. */
const TV = {
  "9882": [
    { id: 1668, name: "Firefly", first_air_date: "2002-09-20" },
    { id: 2316, name: "The Expanse", first_air_date: "2015-11-23" },
  ],
};

const json = (res, body) => {
  res.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // The key rides the query string. Refusing without it is not decoration:
    // it is what proves the app actually sends one.
    if (!url.searchParams.get("api_key")) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status_message: "Invalid API key." }));
    }
    if (url.pathname === "/3/search/keyword") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      return json(res, { page: 1, results: KEYWORDS[q] ?? [] });
    }
    if (url.pathname === "/3/discover/movie" || url.pathname === "/3/discover/tv") {
      const k = url.searchParams.get("with_keywords") ?? "";
      const table = url.pathname.endsWith("/tv") ? TV : MOVIES;
      return json(res, { page: 1, results: table[k] ?? [] });
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status_message: "Not found." }));
  })
  .listen(PORT, () => console.log(`fake-tmdb on :${PORT}`));
