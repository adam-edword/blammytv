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
      extra: [{ name: "genre", options: ["Action", "Comedy"] }, { name: "skip" }],
    },
    {
      type: "series",
      id: "top-series",
      name: "Top Series",
      extra: [{ name: "genre", options: ["Drama", "Comedy"] }, { name: "skip" }],
    },
    // A SECOND browseable movie catalog: Discover's grid must conglomerate
    // across all of the user's lists, not anchor to the first one.
    {
      type: "movie",
      id: "more-movies",
      name: "More Movies",
      extra: [{ name: "genre", options: ["Action"] }, { name: "skip" }],
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

const BY_ID = new Map(
  [...MOVIES, ...SERIES, ...MORE_MOVIES, ...GENRE_MOVIES].map((m) => [m.id, m]),
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
    for (let s = 1; s <= 2; s++) {
      for (let e = 1; e <= 3; e++) {
        meta.videos.push({
          id: `${id}:${s}:${e}`,
          season: s,
          episode: e,
          name: `S${s}E${e} Title`,
          released: `2024-01-0${e}T00:00:00Z`,
          thumbnail: `http://localhost:${PORT}/poster/ep.png`,
        });
      }
    }
  }
  return meta;
}

function streams(id) {
  return [
    {
      name: "⚡ 4K | Debrid",
      description: "Fake Movie 4K\n8.2GB ⚡",
      url: `http://localhost:${PORT}/video/${id}-4k.mp4`,
      behaviorHints: { bingeGroup: "fake|2160p|x265" },
    },
    {
      name: "1080p | Debrid",
      description: "Fake 1080p\n2.1GB",
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

// 1x1 red PNG for the poster/background endpoints.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
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

    if (segs.length === 1 && segs[0] === "manifest") return json(MANIFEST);

    if (segs[0] === "catalog") {
      const [, type, catalogId, extra] = segs;
      // Browse catalogs take OPTIONAL genre/skip extras (Discover's grid);
      // no extra = the plain full list the Stream rows fetch.
      const params = new URLSearchParams(extra ?? "");
      const genreFilter = params.get("genre");
      const skip = Number(params.get("skip") ?? 0) || 0;
      const page = (list) => {
        const filtered = genreFilter
          ? list.filter((m) => (m.genres ?? []).includes(genreFilter))
          : list;
        return json({ metas: filtered.slice(skip, skip + 8) });
      };
      if (type === "movie" && catalogId === "top-movies") return page(MOVIES);
      if (type === "series" && catalogId === "top-series") return page(SERIES);
      if (type === "movie" && catalogId === "more-movies") return page(MORE_MOVIES);
      if (type === "movie" && catalogId === "genre-movies" && extra?.startsWith("genre="))
        return json({ metas: GENRE_MOVIES });
      return notFound();
    }

    if (segs[0] === "meta" && segs.length === 3) {
      const meta = fullMeta(segs[2], segs[1]);
      return meta ? json({ meta }) : notFound();
    }

    if (segs[0] === "stream" && segs.length === 3) return json({ streams: streams(segs[2]) });

    return notFound();
  })
  .listen(PORT, () => console.log(`fake aio addon on :${PORT}`));
