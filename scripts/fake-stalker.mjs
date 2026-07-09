// A tiny fake Stalker/MAG portal for end-to-end wiring tests.
// Serves the single load.php-style endpoint at BOTH classic paths
// (/stalker_portal/server/load.php and /portal.php) with CORS open so
// browser-mode E2Es can hit it directly; scripts/verify-stalker.mjs drives
// the headless assertions against it.
//
//   node scripts/fake-stalker.mjs              → portal on :8083
//   NO_BULK=1 node scripts/fake-stalker.mjs    → get_all_channels returns
//                                                empty (exercises the
//                                                get_ordered_list fallback)
//
// Protocol (see docs/stalker-implementation.md): every action is a GET with
// type/action/JsHttpRequest query params and returns JSON {"js": ...}.
// handshake needs no auth; every other action requires the exact Bearer
// token from the handshake, a Cookie containing "mac=", and a MAG-style
// User-Agent — anything missing gets HTTP 200 {"js":{"error":"Authorization
// failed"}}, so tests can assert header assembly. Covers: both endpoint
// paths (path probing), the "*" pseudo-genre and an adult genre (filter
// tests), a relative and an absolute logo path, a censored channel in an
// innocent genre (stream-level adult flag), get_ordered_list pagination at
// 2 rows/page (genre 1 has 3 channels → 2 pages), an EPG map with a
// programme airing right now, and create_link returning a prefixed
// "ffmpeg http://…?play_token=TOK<n>" URL whose counter increments per call
// so tests can assert per-play re-resolution. /live/<id>.ts and
// /misc/logos/*.png answer with real bytes for playability/logo probes.
import http from "node:http";

const PORT = 8083;
const TOKEN = "FAKETOKEN123";
const NO_BULK = process.env.NO_BULK === "1";

const GENRES = [
  { id: "*", title: "All" },
  { id: "1", title: "News" },
  { id: "2", title: "Sports" },
  { id: "3", title: "XXX Adult" },
];

// Six channels spanning the genres. cmd is the opaque pre-play command the
// app must exchange via create_link (it ends with /ch/<id> so the fake can
// recover the channel id). Genre 1 has three channels so get_ordered_list
// needs two pages at 2/page.
const CHANNELS = [
  {
    id: "101",
    name: "Fake News One",
    number: "1",
    cmd: `ffconc http://localhost:${PORT}/ch/101`,
    xmltv_id: "news1.stalker",
    logo: "misc/logos/one.png", // relative → app must resolve against host
    tv_genre_id: "1",
    censored: 0,
    hd: 1,
    enable_tv_archive: 1,
  },
  {
    id: "102",
    name: "Fake News Two",
    number: "2",
    cmd: `ffconc http://localhost:${PORT}/ch/102`,
    xmltv_id: "news2.stalker",
    logo: `http://localhost:${PORT}/misc/logos/two.png`, // already absolute
    tv_genre_id: "1",
    censored: 0,
    hd: 0,
    enable_tv_archive: 0,
  },
  {
    id: "103",
    name: "Fake Weather Now",
    number: "3",
    cmd: `ffconc http://localhost:${PORT}/ch/103`,
    xmltv_id: "weather.stalker",
    logo: "",
    tv_genre_id: "1",
    censored: 0,
    hd: 0,
    enable_tv_archive: 0,
  },
  {
    id: "104",
    name: "Fake Sports HD",
    number: "4",
    cmd: `ffconc http://localhost:${PORT}/ch/104`,
    xmltv_id: "sports.stalker",
    logo: "misc/logos/sports.png",
    tv_genre_id: "2",
    censored: 0,
    hd: 1,
    enable_tv_archive: 1,
  },
  {
    id: "105",
    name: "Sneaky Flagged Stream",
    number: "5",
    cmd: `ffconc http://localhost:${PORT}/ch/105`,
    xmltv_id: "sneaky.stalker",
    logo: "",
    tv_genre_id: "2", // innocent genre, but the CHANNEL is flagged
    censored: 1,
    hd: 0,
    enable_tv_archive: 0,
  },
  {
    id: "106",
    name: "Late Night Feature",
    number: "6",
    cmd: `ffconc http://localhost:${PORT}/ch/106`,
    xmltv_id: "latenight.stalker",
    logo: "",
    tv_genre_id: "3", // adult genre, flagged
    censored: 1,
    hd: 0,
    enable_tv_archive: 0,
  },
];

// Three programmes per channel bracketing "now": one airing (started 30min
// ago, ends in 30min), one next, one after. Timestamps in UNIX SECONDS.
function programmes(chId) {
  const now = Math.floor(Date.now() / 1000);
  const HOUR = 3600;
  const mk = (i, start, stop, name) => ({
    id: `${chId}-${i}`,
    ch_id: chId,
    name,
    descr: `${name} on channel ${chId}.`,
    start_timestamp: start,
    stop_timestamp: stop,
    duration: stop - start,
  });
  return [
    mk(1, now - 1800, now + 1800, `Now Showing ${chId}`),
    mk(2, now + 1800, now + 1800 + HOUR, `Up Next ${chId}`),
    mk(3, now + 1800 + HOUR, now + 1800 + 2 * HOUR, `Later On ${chId}`),
  ];
}

// 1x1 red PNG for the logo endpoints.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

// Non-handshake actions require all three: the exact Bearer token, a Cookie
// carrying the MAC, and a MAG-looking User-Agent. LAX=1 drops the Cookie/UA
// checks (Bearer still required): browser-mode E2Es drive the app through
// plain fetch, which can't send Cookie (a forbidden header) — in the real
// app those headers go out through the Rust fetch, and the full assembly is
// covered by the data/stalker unit tests, whose mock captures headers.
const LAX = process.env.LAX === "1";
function authorized(req) {
  return (
    req.headers.authorization === `Bearer ${TOKEN}` &&
    (LAX ||
      ((req.headers.cookie ?? "").includes("mac=") &&
        (req.headers["user-agent"] ?? "").includes("MAG")))
  );
}

let playCounter = 0;

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Custom headers (Authorization) make browser fetches non-simple, so a
    // CORS preflight arrives before every call — approve it wholesale.
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] ?? "*",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.statusCode = 204;
      return res.end();
    }
    const action = url.searchParams.get("action");
    console.log(
      `${req.method} ${url.pathname}${action ? ` action=${action}` : ""}`,
    );

    if (url.pathname.startsWith("/live/") && url.pathname.endsWith(".ts")) {
      res.setHeader("Content-Type", "video/mp2t");
      return res.end(Buffer.from("FAKE-TS-BYTES"));
    }
    if (url.pathname.startsWith("/misc/logos/") && url.pathname.endsWith(".png")) {
      res.setHeader("Content-Type", "image/png");
      return res.end(PNG);
    }

    // The API lives at both common install paths so path probing is testable.
    if (
      url.pathname !== "/stalker_portal/server/load.php" &&
      url.pathname !== "/portal.php"
    ) {
      res.statusCode = 404;
      return res.end("not found");
    }

    res.setHeader("Content-Type", "application/json");
    const js = (payload) => res.end(JSON.stringify({ js: payload }));
    const type = url.searchParams.get("type");

    if (type === "stb" && action === "handshake")
      return js({ token: TOKEN, random: "r" });

    // Real portals answer HTTP 200 with an error body, not a 401/403.
    if (!authorized(req)) return js({ error: "Authorization failed" });

    if (type === "stb" && action === "get_profile")
      return js({ id: 1, name: "fake", blocked: "0" });

    if (type === "itv" && action === "get_genres") return js(GENRES);

    if (type === "itv" && action === "get_all_channels")
      return js({ data: NO_BULK ? [] : CHANNELS });

    if (type === "itv" && action === "get_ordered_list") {
      const genre = url.searchParams.get("genre") ?? "*";
      const page = Math.max(1, Number(url.searchParams.get("p")) || 1);
      const rows =
        genre === "*"
          ? CHANNELS
          : CHANNELS.filter((c) => c.tv_genre_id === genre);
      const PER_PAGE = 2; // small on purpose: 3 channels → 2 pages
      return js({
        total_items: rows.length,
        max_page_items: PER_PAGE,
        data: rows.slice((page - 1) * PER_PAGE, page * PER_PAGE),
      });
    }

    if (type === "itv" && action === "get_epg_info") {
      const map = {};
      for (const c of CHANNELS) map[c.id] = programmes(c.id);
      return js(map);
    }

    if (type === "itv" && action === "get_short_epg") {
      const chId = url.searchParams.get("ch_id") ?? "";
      const size = Number(url.searchParams.get("size")) || 3;
      return js(programmes(chId).slice(0, size));
    }

    if (type === "itv" && action === "create_link") {
      // The incoming cmd is the channel row's opaque command, ending in
      // /ch/<id>. Hand back a prefixed, tokenized URL — the counter makes
      // every resolution distinct so tests catch stale-URL reuse.
      const cmd = url.searchParams.get("cmd") ?? "";
      const chId = /\/ch\/(\w+)$/.exec(cmd)?.[1] ?? "0";
      playCounter += 1;
      return js({
        cmd: `ffmpeg http://localhost:${PORT}/live/${chId}.ts?play_token=TOK${playCounter}`,
      });
    }

    return js({ error: `unknown action ${type}/${action}` });
  })
  .listen(PORT, () =>
    console.log(`fake stalker portal on :${PORT}${NO_BULK ? " (NO_BULK)" : ""}`),
  );
