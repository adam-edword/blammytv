// A tiny fake Stremio/AIOStreams addon for end-to-end wiring tests.
// Serves the standard Stremio addon HTTP GET protocol (manifest / catalog /
// meta / stream, all JSON) with CORS open so browser-mode E2Es can hit it
// directly.
//
//   node scripts/fake-aio.mjs        → addon on :8084
//
// Covers: a plain browsable movie catalog and a series catalog, a catalog
// with a REQUIRED genre extra (selectable-for-hero only once a genre is
// chosen — including the "None" pseudo-genre path), a search-only catalog
// that must be filtered out of browse entirely, two sparse movie metas with
// no poster/description (Cinemeta-fallback material — Cinemeta won't exist
// in tests; that path is covered by unit mocks), series metas with 2×3
// season/episode videos, and stream lists whose ids may contain COLONS
// (tt200001:1:2) arriving either raw or URL-encoded (%3A) — both must
// resolve. Each stream list ends with a magnet-only entry (infoHash, no
// url) that the app must filter out. /poster/*.png, /bg/*.png and
// /video/*.mp4 answer with real bytes for playability/artwork probes.
// /genrerows/ and /genrerows-bare/ are two further addons of their own, for
// Discover's genre rows (verify-genrerows); see the block above GENRE_ROWS.
import http from "node:http";

const PORT = 8084;

const MANIFEST = {
  id: "fake.aio",
  version: "1.0.0",
  name: "Fake AIOStreams",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    // Optional genre extra: Discover's rail + grid filter exercise it;
    // browse rows ignore optional extras, so Stream behavior is unchanged.
    {
      type: "movie",
      id: "top-movies",
      name: "Top Movies",
      extra: [
        { name: "genre", options: ["Action", "Comedy"] },
        { name: "skip" },
        { name: "search" },
      ],
    },
    {
      type: "series",
      id: "top-series",
      name: "Top Series",
      extra: [
        { name: "genre", options: ["Drama", "Comedy"] },
        { name: "skip" },
        { name: "search" },
      ],
    },
    // A SECOND browseable movie catalog: Discover's grid must conglomerate
    // across all of the user's lists, not anchor to the first one.
    {
      type: "movie",
      id: "more-movies",
      name: "More Movies",
      // Genre extra WITHOUT options — the real-manifest shape that must
      // serve ANY genre (v0.3.18); its Action-only content answers other
      // genres with an empty page.
      extra: [{ name: "genre" }, { name: "skip" }],
    },
    // Required-genre catalog: only selectable for hero with genre=None.
    {
      type: "movie",
      id: "genre-movies",
      name: "By Genre",
      extra: [{ name: "genre", isRequired: true, options: ["Action", "Drama"] }],
    },
    // Search-only catalog: must be filtered out of browse.
    {
      type: "movie",
      id: "search-only",
      name: "Search",
      extra: [{ name: "search", isRequired: true }],
    },
  ],
};

const NUMBERS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
const poster = (id) => `http://localhost:${PORT}/poster/${id}.png`;

// Eight movies; the last two are SPARSE (no poster, no description) so the
// app has Cinemeta-fallback material to chew on.
/**
 * SPACED TITLES, for the search that made this necessary.
 *
 * "Iron Man" is the whole point: a user typing "ironman" used to get
 * nothing, because these catalogs match a SUBSTRING of the title and the
 * title has a space in it. The sequel is here so ranking has something to
 * order against, and the unrelated title is the control that a broadened
 * fallback query does not just return the catalog.
 */
const SPACED = [
  { id: "tt300001", type: "movie", name: "Iron Man", genres: ["Action"] },
  { id: "tt300002", type: "movie", name: "Iron Man 2", genres: ["Action"] },
  { id: "tt300003", type: "movie", name: "The Dark Knight", genres: ["Action"] },
  // NOISE THE BROADENED QUERY WILL CATCH, and it has to exist or the check
  // that the noise is filtered passes for free. The fallback for "ironman"
  // asks for "iron", which this title contains — and it is NOT what was
  // meant, so ranking has to score it out. Without a title like this in the
  // fixture the drop is untested: the first version of that check passed
  // with the filter switched off.
  { id: "tt300004", type: "movie", name: "The Iron Giant", genres: ["Action"] },
];

const MOVIES = NUMBERS.map((word, i) => {
  const id = `tt10000${i + 1}`;
  const sparse = i >= 6; // tt100007, tt100008
  return {
    id,
    type: "movie",
    name: `Fake Movie ${word}`,
    ...(sparse
      ? {}
      : { poster: poster(id), description: `A perfectly fake movie, number ${word}.` }),
    // Cinemeta-style: catalog previews carry runtime too (some entries
    // deliberately without, matching real-world spotty coverage).
    ...(i % 2 === 0 ? { runtime: `${95 + i * 7} min` } : {}),
    genres: i % 2 === 0 ? ["Action"] : ["Comedy"],
  };
});

const SERIES = NUMBERS.slice(0, 4).map((word, i) => {
  const id = `tt20000${i + 1}`;
  return {
    id,
    type: "series",
    name: `Fake Series ${word}`,
    poster: poster(id),
    description: `A perfectly fake series, number ${word}.`,
    genres: i % 2 === 0 ? ["Drama"] : ["Comedy"],
  };
});

// The second browseable movie list (distinct ids/titles so the E2E can
// prove the conglomerate grid mixes catalogs).
const MORE_MOVIES = NUMBERS.slice(0, 2).map((word, i) => {
  const id = `tt40000${i + 1}`;
  return {
    id,
    type: "movie",
    name: `Extra Movie ${word}`,
    poster: poster(id),
    description: `An extra fake movie, number ${word}.`,
    genres: ["Action"],
  };
});

const GENRE_MOVIES = NUMBERS.slice(0, 3).map((word, i) => {
  const id = `tt30000${i + 1}`;
  return {
    id,
    type: "movie",
    name: `Genre Movie ${word}`,
    poster: poster(id),
    description: `A genre-locked fake movie, number ${word}.`,
  };
});

/**
 * TITLES IN NO CATALOG, reached by id (a Continue Watching entry's card, then
 * its Sources chip), for verify-stream-four. They are in BY_ID for the meta
 * route and in none of the catalogs above, so no row, grid or search counts
 * them and every other harness reads what it always did.
 *
 * - tt500001, a series whose episode 4 has not aired: the episode list draws
 *   it dim, and the Up Next card after episode 3 has nothing to offer.
 * - tt500002, a film with two cached releases and one that is not, each with
 *   the file name an addon sends, and a statistic at the end of the list.
 * - tt500003, a film whose whole answer is notices: an addon's error and a
 *   statistic, as AIOStreams sends them (no url, streamData.type), and a
 *   magnet-only entry that is NOT one.
 */
const HIDDEN = [
  {
    id: "tt500001",
    type: "series",
    name: "Fake Series Airing",
    poster: poster("tt500001"),
    description: "A series whose fourth episode has not aired.",
    genres: ["Drama"],
  },
  {
    id: "tt500002",
    type: "movie",
    name: "Fake Movie Two Releases",
    poster: poster("tt500002"),
    description: "A film that comes in two cached releases.",
    genres: ["Action"],
  },
  {
    id: "tt500003",
    type: "movie",
    name: "Fake Movie Notices",
    poster: poster("tt500003"),
    description: "A film nothing could be found for.",
    genres: ["Action"],
  },
];

const BY_ID = new Map(
  [...MOVIES, ...SERIES, ...MORE_MOVIES, ...GENRE_MOVIES, ...HIDDEN].map((m) => [m.id, m]),
);
const SPARSE_IDS = new Set(["tt100007", "tt100008"]);

// Full meta object for an id. Sparse ids stay sparse here too (no poster,
// no description) — the app should then fall back to Cinemeta.
function fullMeta(id, type) {
  const preview = BY_ID.get(id);
  if (!preview || preview.type !== type) return null;
  const sparse = SPARSE_IDS.has(id);
  const meta = {
    id,
    type,
    name: preview.name,
    ...(sparse ? {} : { poster: poster(id), description: `Full synopsis for ${id}.` }),
    background: `http://localhost:${PORT}/bg/${id}.png`,
    runtime: "1h58min",
    releaseInfo: "2024",
    genres: ["Action", "Drama"],
    cast: ["Actor A", "Actor B"],
  };
  if (type === "series") {
    // 2 seasons × 3 episodes, all released in the past — Stremio marks
    // upcoming episodes by future `released`, not an available flag.
    meta.videos = [];
    // tt500001: one season of four, the last far in the future (a day, as
    // Cinemeta sends one) so the harness does not depend on today's date.
    const seasons = id === "tt500001" ? 1 : 2;
    const perSeason = id === "tt500001" ? 4 : 3;
    for (let s = 1; s <= seasons; s++) {
      for (let e = 1; e <= perSeason; e++) {
        meta.videos.push({
          id: `${id}:${s}:${e}`,
          season: s,
          episode: e,
          name: `S${s}E${e} Title`,
          released: id === "tt500001" && e === 4 ? "2099-03-05T00:00:00.000Z" : `2024-01-0${e}T00:00:00Z`,
          thumbnail: `http://localhost:${PORT}/poster/ep.png`,
        });
      }
    }
  }
  return meta;
}

function streams(id) {
  if (id === "tt500002") return TWO_RELEASES(id);
  if (id === "tt500003") return NOTICES_ONLY;
  return [
    {
      name: "⚡ 4K | Debrid",
      description: "Fake Movie 4K\n8.2GB ⚡",
      url: `http://localhost:${PORT}/video/${id}-4k.mp4`,
      behaviorHints: { bingeGroup: "fake|2160p|x265" },
    },
    {
      name: "1080p | Debrid",
      // A rating line as Adam's addon writes one, with the half star no
      // Windows font has (v0.10.17; verify-kit checks it is drawn).
      description: "Fake 1080p\n2.1GB\n★⯪☆☆☆",
      url: `http://localhost:${PORT}/video/${id}-1080.mp4`,
      behaviorHints: { bingeGroup: "fake|1080p" },
    },
    {
      name: "Torrent",
      infoHash: "deadbeef",
      description: "magnet-only entry (must be FILTERED OUT by the app — no url)",
    },
  ];
}

const ABOUT = "https://example.test/aiostreams";

// Two releases cached, one not, each with the file name an addon sends
// (behaviorHints.filename), and a statistic at the end as AIOStreams puts one.
const TWO_RELEASES = (id) => [
  {
    name: "⚡ 4K | Debrid",
    description: "Two Releases 4K\n8.2GB ⚡",
    url: `http://localhost:${PORT}/video/${id}-4k.mp4`,
    behaviorHints: { bingeGroup: "fake|2160p|x265", filename: "Two.Releases.2160p.WEB-DL.mkv" },
  },
  {
    name: "⚡ 1080p | Debrid",
    description: "Two Releases 1080p\n2.1GB ⚡",
    url: `http://localhost:${PORT}/video/${id}-1080.mp4`,
    behaviorHints: { bingeGroup: "fake|1080p", filename: "Two.Releases.1080p.BluRay.mkv" },
  },
  {
    name: "⏳ 720p | Debrid",
    description: "Two Releases 720p\n1.0GB ⏳",
    url: `http://localhost:${PORT}/video/${id}-720.mp4`,
    behaviorHints: { bingeGroup: "fake|720p", filename: "Two.Releases.720p.WEB.mkv" },
  },
  {
    name: "Statistics",
    description: "Fetched 3 streams in 0.4s",
    externalUrl: ABOUT,
    streamData: { type: "statistic" },
  },
];

// Nothing playable, and AIOStreams saying why: an addon's error and a
// statistic, both with no url, then a magnet-only entry that carries text and
// is not a message.
const NOTICES_ONLY = [
  {
    name: "Torbox",
    description: "Rate limit exceeded",
    externalUrl: ABOUT,
    streamData: { type: "error" },
  },
  {
    name: "Statistics",
    description: "Fetched 0 streams in 1.2s\n80 results filtered out",
    externalUrl: ABOUT,
    streamData: { type: "statistic" },
  },
  { name: "Magnet", infoHash: "deadbeef", description: "magnet-only entry, not a message" },
];

/**
 * TWO MORE ADDONS UNDER THEIR OWN PATHS, for Discover's genre rows (plan 034,
 * verify-genrerows). A manifest URL of `http://localhost:8084/genrerows/manifest.json`
 * reads everything below from `/genrerows/…` and nothing above, so no other
 * harness sees a catalog or a title it did not before.
 *
 * `/genrerows/` is Comedy built to be cut into rows:
 *   - gr-top: genre options Comedy/Drama/Horror, filters by genre. 25 titles in
 *     pages of 8, so the pool (three pages) holds 24 and the 25th arrives only
 *     when See All Comedy scrolls: six pure comedies, six Romance + Comedy
 *     (exactly the floor for a row), five Horror + Comedy (one under it), six
 *     Western + Comedy (a row named "Comedy and Western"), one Comedy + Crime +
 *     Drama that must rank under every pure title however well it is rated, and
 *     a pure comedy rated 9.5 that arrives late.
 *   - gr-more: genre extra with no options, filters. Three of gr-top's pure
 *     comedies again, so a title can be in two or three catalogs.
 *   - gr-loose: genre extra with no options that IGNORES the filter, as real
 *     catalogs do. Two off-genre titles (Horror + Crime, Drama), two with no
 *     genres at all, and a pure comedy.
 *   - gr-series: a series catalog, Comedy and Drama options, filters.
 * Its TMDB half (verify-genrerows routes api.themoviedb.org) names eight films
 * and two shows, of which the addon has six and two: tt7000N, tt7100N.
 *
 * `/genrerows-bare/` is a catalog whose titles carry no genres at all, which
 * Comedy can only show as the ranked grid.
 */
const grPoster = (id) => `http://localhost:${PORT}/poster/${id}.png`;
const gr = (id, name, genres, o = {}) => ({
  id,
  type: o.type ?? "movie",
  name,
  poster: grPoster(id),
  description: `${name}, a fake title.`,
  releaseInfo: "2024",
  ...(o.rating ? { imdbRating: String(o.rating) } : {}),
  ...(genres ? { genres } : {}),
});
const SIX = ["One", "Two", "Three", "Four", "Five", "Six"];
const GR_PURE = SIX.map((w, i) => gr(`tt6000${i + 1}`, `GR Pure ${w}`, ["Comedy"], { rating: [7, 8, 6, 9, 5, 7.5][i] }));
const GR_ROMANCE = SIX.map((w, i) => gr(`tt6100${i + 1}`, `GR Romance ${w}`, ["Comedy", "Romance"], { rating: 7 }));
const GR_HORROR = SIX.slice(0, 5).map((w, i) => gr(`tt6200${i + 1}`, `GR Horror ${w}`, ["Comedy", "Horror"], { rating: 7 }));
const GR_WESTERN = SIX.map((w, i) => gr(`tt6400${i + 1}`, `GR Western ${w}`, ["Comedy", "Western"], { rating: 7 }));
const GR_TRIO = gr("tt63001", "GR Trio", ["Comedy", "Crime", "Drama"], { rating: 9.9 });
const GR_LATE = gr("tt60007", "GR Pure Late", ["Comedy"], { rating: 9.5 });
const GR_OFF = [gr("tt65001", "GR Off Horror", ["Horror", "Crime"]), gr("tt65002", "GR Off Drama", ["Drama"])];
const GR_BLANK = [gr("tt66001", "GR Blank One", null), gr("tt66002", "GR Blank Two", null)];
const GR_SHOWS = [1, 2, 3, 4].map((n) =>
  gr(`tt6700${n}`, `GR Show ${SIX[n - 1]}`, n === 4 ? ["Comedy", "Drama"] : ["Comedy"], { type: "series" }),
);
const [P1, P2, P3, P4, P5, P6] = GR_PURE;
const grList = (...lists) => lists.flat();
// What TMDB's popular titles are, once the addon is asked for each.
const GR_POPULAR = [1, 2, 3, 4, 5, 6].map((n) => gr(`tt7000${n}`, `GR Popular ${SIX[n - 1]}`, ["Comedy"], { rating: 7 }));
const GR_POPULAR_SHOWS = [1, 2].map((n) => gr(`tt7100${n}`, `GR Popular Show ${SIX[n - 1]}`, ["Comedy"], { type: "series" }));
const GENRE_ROWS = {
  genrerows: {
    manifest: {
      id: "fake.aio.genrerows",
      version: "1.0.0",
      name: "Fake Genre Rows",
      resources: ["catalog", "meta", "stream"],
      types: ["movie", "series"],
      catalogs: [
        { type: "movie", id: "gr-top", name: "GR Top", extra: [{ name: "genre", options: ["Comedy", "Drama", "Horror"] }, { name: "skip" }] },
        { type: "movie", id: "gr-more", name: "GR More", extra: [{ name: "genre" }, { name: "skip" }] },
        { type: "movie", id: "gr-loose", name: "GR Loose", extra: [{ name: "genre" }, { name: "skip" }] },
        { type: "series", id: "gr-series", name: "GR Series", extra: [{ name: "genre", options: ["Comedy", "Drama"] }, { name: "skip" }] },
      ],
    },
    catalogs: {
      "movie:gr-top": { filters: true, list: grList([P2, P1, P3], GR_ROMANCE, GR_HORROR, [GR_TRIO, P4, P5, P6], GR_WESTERN, [GR_LATE]) },
      "movie:gr-more": { filters: true, list: [P1, P3, P5] },
      "movie:gr-loose": { filters: false, list: [GR_OFF[0], GR_OFF[1], P1, ...GR_BLANK] },
      "series:gr-series": { filters: true, list: GR_SHOWS },
    },
    known: [...GR_POPULAR, ...GR_POPULAR_SHOWS],
  },
  "genrerows-bare": {
    manifest: {
      id: "fake.aio.genrerows-bare",
      version: "1.0.0",
      name: "Fake Bare Genre Rows",
      resources: ["catalog", "meta", "stream"],
      types: ["movie"],
      catalogs: [{ type: "movie", id: "bare-top", name: "Bare Top", extra: [{ name: "genre", options: ["Comedy"] }, { name: "skip" }] }],
    },
    catalogs: {
      "movie:bare-top": {
        filters: false,
        list: Array.from({ length: 12 }, (_, i) => gr(`tt680${String(i + 1).padStart(2, "0")}`, `Bare ${i + 1}`, null)),
      },
    },
    known: [],
  },
};

function genreRowsAddon(name, rest, json, notFound) {
  const world = GENRE_ROWS[name];
  if (rest.length === 1 && rest[0] === "manifest") return json(world.manifest);
  if (rest[0] === "catalog") {
    const [, type, id, extra] = rest;
    const cat = world.catalogs[`${type}:${id}`];
    if (!cat) return notFound();
    const params = new URLSearchParams(extra ?? "");
    const genre = params.get("genre");
    const skip = Number(params.get("skip") ?? 0) || 0;
    const list = cat.filters && genre ? cat.list.filter((m) => (m.genres ?? []).includes(genre)) : cat.list;
    return json({ metas: list.slice(skip, skip + 8) });
  }
  if (rest[0] === "meta" && rest.length === 3) {
    const found = world.known.find((m) => m.id === rest[2] && m.type === rest[1]);
    return found ? json({ meta: { ...found, background: `http://localhost:${PORT}/bg/${found.id}.png` } }) : notFound();
  }
  return notFound();
}

/** How many times each stream list was asked for, by `type/id`, for the
 * harnesses that count asks at the addon: GET /__asked/series/tt1:1:2 answers
 * {"count": n}. Their own reads are not counted. */
const asked = new Map();

// 1x1 red PNG for the poster/background endpoints.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Let browser-mode E2Es read the forensic headers below (the Rust
    // path sees them regardless; only fetch() is CORS-gated).
    res.setHeader("Access-Control-Expose-Headers", "*");
    // Approve any CORS preflight wholesale.
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] ?? "*",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.statusCode = 204;
      return res.end();
    }
    console.log(`${req.method} ${url.pathname}`);

    // A fake Cloudflare challenge (the Bobby-403 shape): any path under
    // /cf/ answers 403 with the identifying headers, so the Connection
    // Test's forensic line is E2E-able browser-side.
    if (url.pathname.startsWith("/cf/")) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/html; charset=UTF-8");
      res.setHeader("Server", "cloudflare");
      res.setHeader("Cf-Mitigated", "challenge");
      res.setHeader("Cf-Ray", "0000feedfacef00d-FAKE");
      return res.end(
        "<!DOCTYPE html><html><head><title>Just a moment...</title></head>" +
          "<body>Checking your browser before accessing</body></html>",
      );
    }

    if (url.pathname.startsWith("/poster/") || url.pathname.startsWith("/bg/")) {
      res.setHeader("Content-Type", "image/png");
      return res.end(PNG);
    }
    if (url.pathname.startsWith("/video/")) {
      res.setHeader("Content-Type", "video/mp4");
      return res.end(Buffer.from("FAKE-MP4-BYTES"));
    }

    const notFound = () => {
      res.statusCode = 404;
      return res.end("not found");
    };

    // Stremio addon routes are /resource/type/id[/extra].json where the id
    // segment may contain raw colons (tt200001:1:2) or arrive URL-encoded
    // (%3A) — decode every segment so both spellings resolve.
    const segs = url.pathname
      .replace(/\.json$/, "")
      .split("/")
      .slice(1)
      .map(decodeURIComponent);
    const json = (payload) => {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(payload));
    };

    if (GENRE_ROWS[segs[0]]) return genreRowsAddon(segs[0], segs.slice(1), json, notFound);

    if (segs.length === 1 && segs[0] === "manifest") return json(MANIFEST);

    if (segs[0] === "catalog") {
      const [, type, catalogId, extra] = segs;
      // Browse catalogs take OPTIONAL genre/skip extras (Discover's grid);
      // no extra = the plain full list the Stream rows fetch.
      const params = new URLSearchParams(extra ?? "");
      const genreFilter = params.get("genre");
      const search = params.get("search");
      const skip = Number(params.get("skip") ?? 0) || 0;
      const page = (list) => {
        let filtered = genreFilter
          ? list.filter((m) => (m.genres ?? []).includes(genreFilter))
          : list;
        if (search)
          filtered = filtered.filter((m) =>
            m.name.toLowerCase().includes(search.toLowerCase()),
          );
        return json({ metas: filtered.slice(skip, skip + 8) });
      };
      if (type === "movie" && catalogId === "top-movies")
        return page([...MOVIES, ...SPACED]);
      if (type === "series" && catalogId === "top-series") return page(SERIES);
      if (type === "movie" && catalogId === "more-movies") return page(MORE_MOVIES);
      // Search-only catalog: answers ONLY the search extra.
      if (type === "movie" && catalogId === "search-only" && search)
        return page(GENRE_MOVIES);
      if (type === "movie" && catalogId === "genre-movies" && extra?.startsWith("genre="))
        return json({ metas: GENRE_MOVIES });
      return notFound();
    }

    if (segs[0] === "meta" && segs.length === 3) {
      const meta = fullMeta(segs[2], segs[1]);
      return meta ? json({ meta }) : notFound();
    }

    if (segs[0] === "__asked" && segs.length === 3)
      return json({ count: asked.get(`${segs[1]}/${segs[2]}`) ?? 0 });

    if (segs[0] === "stream" && segs.length === 3) {
      const key = `${segs[1]}/${segs[2]}`;
      asked.set(key, (asked.get(key) ?? 0) + 1);
      return json({ streams: streams(segs[2]) });
    }

    return notFound();
  })
  .listen(PORT, () => console.log(`fake aio addon on :${PORT}`));
