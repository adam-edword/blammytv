// E2E: Stream, Discover and the hero picker over AIOStreams' Jellyfin side,
// signed in (plan 024, B3a), with a fake of that side in this process. The
// page's aiojf commands (aiojf.rs in the app) are stubbed to forward to the
// fake, the way verify-aiojf stubs them: aiojf.rs's own tests cover the
// token, the header, the guard and the source whitelist; this covers what the
// app asks AIOStreams for and what it does with the answers.
//
// The fake mirrors AIOStreams v2.35.9 for every route the app uses here:
//   /UserViews, /Genres?ParentId, /Items (ParentId, StartIndex, Limit, Genres,
//   SearchTerm, IncludeItemTypes), /Items/{id}, /Shows/{id}/Episodes (Limit
//   1000 unasked, 2000 at most), and PlaybackInfo with Fresh and Refresh
//   (playback.ts: a kept list is reused, Fresh within 180s, Refresh searches
//   again). It RECORDS what must never happen: a `GET /Items/{id}` with no
//   `Fields` or with MediaSources in it (it runs the stream search for a film
//   or an episode, the same work as pressing play), and a PlaybackInfo that
//   did not come through `aiojf_sources`. The stub for `aiojf_sources`
//   applies B1's whitelist, so nothing the app sees carries the subtitle
//   URLs, which hold the token. It is also a small Stremio addon, for the
//   scenes that read the manifest.
//
// - Signed in, no manifest URL: Stream's rows are the views, in the config's
//   order, with their titles and posters from the instance; a view whose
//   genre is required is not a row; browsing asks for no sources.
// - A film's page: title, synopsis, cast, genres, from the item. Its sources
//   are the formatter's lines, grouped by cache from `aiostreams.cached`, the
//   quality badge from `bingeGroup`, a placeholder never shown. Play hands
//   the player the source's own Path, byte for byte.
// - A show's page: seasons and episodes from /Shows/{id}/Episodes, with
//   tt...:S:E ids; an episode's sources are asked by its packed id.
// - A title with a hashed id (b2..., its Stremio id only in its Path) opens
//   and plays through the id map.
// - Discover: a genre page asks Genres and StartIndex, a search asks
//   SearchTerm.
// - Opens ask Fresh, Retry (the dead card's) asks Refresh.
// - A film a catalog named for collections lists as a BoxSet (AIOStreams'
//   items.ts isBoxsetEntry) opens and plays by the id its Stremio id
//   computes: the boxset id 404s on /Items and never starts a search, so it
//   is never learned. A catalog with no genre options is still asked by a
//   Discover genre page (AIOStreams answers an empty page for a genre it
//   cannot serve, so claiming the extra is safe).
// - Every catalog empty, signed in: the empty state talks about the sign-in,
//   not a manifest.
// - Signed out, or on a build that cannot open sources by sign-in, with a
//   manifest stored: Stream reads the manifest.
//
// Offline, as every harness is: every host but localhost is aborted.
//
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-signin.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// ----------------------------------------------------------- packed ids
// AIOStreams' item id: 0xa1, (kind << 4) | id type, the Stremio type, the
// numeric id (6 bytes), season and episode (2 bytes each, 0xffff for none),
// three zero bytes. Written here on its own, not with the app's ids.ts, so a
// slip there cannot hide behind itself. tt0111161 as a movie is
// a1110100000001b239ffffffff000000.
const KIND = { movie: 1, series: 2, episode: 4, boxset: 5 };
const MEDIA = { movie: 1, series: 2 };
function pack(kind, imdb, media, season = 0xffff, episode = 0xffff) {
  const b = Buffer.alloc(16);
  b[0] = 0xa1;
  b[1] = (KIND[kind] << 4) | 1;
  b[2] = MEDIA[media];
  b.writeUIntBE(Number(imdb.slice(2)), 3, 6);
  b.writeUInt16BE(season, 9);
  b.writeUInt16BE(episode, 11);
  return b.toString("hex");
}
if (pack("movie", "tt0111161", "movie") !== "a1110100000001b239ffffffff000000") throw new Error("pack() disagrees with the plan's vector");

// ----------------------------------------------------------- the fixtures
const TICKS = 10_000_000;
/** The hashed id of a title from an addon's own id scheme (the `b2` mark). */
const HASHED = "b2" + "7".repeat(30);

const film = (tt, name, genres, jid = pack("movie", tt, "movie")) => ({ kind: "movie", stremio: tt, name, genres, jid });
const show = (tt, name, genres, seasons) => ({ kind: "series", stremio: tt, name, genres, jid: pack("series", tt, "series"), seasons });
const ONE = film("tt0100001", "Fake Movie One", ["Action", "Drama"]);
const TWO = film("tt0100002", "Fake Movie Two", ["Drama"]);
const ADDON = film("custom:addon1", "Addon Only", ["Action"], HASHED);
// Enough Action films that a genre grid has a second page at 40 a page.
const FILLERS = Array.from({ length: 60 }, (_, i) =>
  film(`tt${String(101000 + i).padStart(7, "0")}`, `Filler Movie ${i + 1}`, ["Action"]),
);
const SERIES_ONE = show("tt0200001", "Fake Series One", ["Drama"], [3, 3]);
const SERIES_TWO = show("tt0200002", "Fake Series Two", ["Comedy"], [2]);
const WESTERN = film("tt0300001", "Western Film", ["Western"]);

// The config's catalogs, in its order: the third needs a genre, so it is a
// library but no row.
const VIEWS = [
  { id: "a2" + "1".repeat(30), type: "movie", cid: "fake.trending", name: "Trending Movies", genres: ["Action", "Drama"], items: [ONE, TWO, ADDON, ...FILLERS] },
  { id: "a2" + "2".repeat(30), type: "series", cid: "fake.shows", name: "Popular Shows", genres: ["Comedy", "Drama"], items: [SERIES_ONE, SERIES_TWO] },
  { id: "a2" + "3".repeat(30), type: "movie", cid: "fake.bygenre", name: "By Genre", genres: ["Western", "Noir"], required: true, items: [WESTERN] },
];
// Two more catalogs, shown only to the scenes that ask for them (`jf.extras`),
// so the checks on the three above keep their counts. The first is named for
// collections: AIOStreams lists a movie in any catalog whose type, id or name
// matches /collection/i as a BoxSet with a packed boxset id (items.ts
// isBoxsetEntry). The second lists no genres at all.
const COLLECTED = film("tt0400001", "Collected Film", ["Drama"]);
const BAGGED = film("tt0400002", "Bagged Film", ["Action"]);
const EXTRA_VIEWS = [
  { id: "a2" + "4".repeat(30), type: "movie", cid: "fake.collections", name: "Movie Collections", genres: [], boxset: true, items: [COLLECTED] },
  { id: "a2" + "5".repeat(30), type: "movie", cid: "fake.nooptions", name: "Plain Picks", genres: [], items: [BAGGED] },
];
const ALL_TITLES = [...VIEWS.flatMap((v) => v.items), ...EXTRA_VIEWS.flatMap((v) => v.items)];
/** The boxset id AIOStreams gives a plain film in a catalog named for collections. */
const boxsetJid = (t) => pack("boxset", t.stremio, "movie");

const episodeJid = (s, season, n) => pack("episode", s.stremio, "series", season, n);
const episodesOf = (s) =>
  s.seasons.flatMap((count, i) =>
    Array.from({ length: count }, (_, j) => ({ season: i + 1, n: j + 1, jid: episodeJid(s, i + 1, j + 1) })),
  );

// A source for every combination the list can hold. Its Path is the stream's
// own URL, and is nasty on purpose (escapes, a query, a colon-free path that
// still has parentheses): the player must get it byte for byte.
const SOURCES = [
  { key: "a", name: "⚡ Fake Debrid", description: "Fake.File.2160p.WEB-DL\n8.2 GB | HDR10", bingeGroup: "aio|2160p|alpha", cached: true, service: "realdebrid", type: "debrid", size: 8_200_000_000 },
  { key: "ph", placeholder: true },
  { key: "b", name: "⚡ Fake Debrid", description: "Fake.File.1080p.WEB-DL\n3.1 GB", bingeGroup: "aio|1080p|beta", cached: true, service: "realdebrid", type: "debrid", size: 3_100_000_000 },
  { key: "d", name: "Direct", description: "Direct link\nNo cache info", bingeGroup: "aio|720p|direct", type: "http", size: 900_000_000 },
  { key: "u", name: "⏳ Fake Debrid", description: "Fake.File.1080p.BluRay\n12.4 GB", bingeGroup: "aio|1080p|gamma", cached: false, service: "realdebrid", type: "debrid", size: 12_400_000_000 },
];
let ORIGIN = "";
const pathOf = (jid, key) =>
  `${ORIGIN}/video/${jid}/Fake%20File%20%282024%29%20%5B${key}%5D.mkv?md5=a%2Fb%3D&expires=1700000000&x=%C3%A9`;

function mediaSources(jid) {
  return SOURCES.map((s, i) => {
    const id = i === 0 ? jid : `ms-${jid}-${s.key}`;
    if (s.placeholder)
      return { Protocol: "Http", Id: id, Path: `${ORIGIN}/notice`, Type: "Placeholder", Name: "Statistics: 4 streams found", IsRemote: true, IsInfiniteStream: false, MediaStreams: [] };
    return {
      Protocol: "Http",
      Id: id,
      Path: pathOf(jid, s.key),
      Type: "Default",
      Container: "mkv",
      Size: s.size,
      Name: `${s.name}\n${s.description}`,
      IsRemote: true,
      ETag: `etag-${id}`,
      RunTimeTicks: 6000 * TICKS,
      IsInfiniteStream: false,
      Bitrate: 1,
      // What the native side drops (SOURCE_KEEPS in aiojf.rs): the subtitle URL
      // carries the token.
      MediaStreams: [{ Type: "Subtitle", Index: 1, DeliveryUrl: `/Videos/${jid}/Subtitles/1/0/Stream.vtt?api_key=SECRET-TOKEN` }],
      aiostreams: {
        name: s.name,
        description: s.description,
        addon: "Fake Addon",
        service: s.service,
        cached: s.cached,
        proxied: false,
        size: s.size,
        filename: `Fake.File.${s.key}.mkv`,
        type: s.type,
        bingeGroup: s.bingeGroup,
        id,
      },
    };
  });
}

// ----------------------------------------------------------- the Jellyfin side
/** Every call the Jellyfin routes answered. */
const calls = [];
/** What must never happen. */
const violations = [];
const jf = {
  /** The kept stream lists, by item, as playback.ts keeps them. */
  memo: new Map(),
  /** Stream searches actually run. */
  searches: 0,
  /** PlaybackInfo calls, with their body. */
  playbackInfo: [],
  /** Show the two extra catalogs above. */
  extras: false,
  /** Answer every catalog page with nothing. */
  empty: false,
};
const resetFake = () => {
  calls.length = 0;
  violations.length = 0;
  credentials.length = 0;
  jf.memo.clear();
  jf.searches = 0;
  jf.playbackInfo.length = 0;
  jf.extras = false;
  jf.empty = false;
};
const viewsNow = () => (jf.extras ? [...VIEWS, ...EXTRA_VIEWS] : VIEWS);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const list = (items, total = items.length, start = 0) => ({ Items: items, TotalRecordCount: total, StartIndex: start });
const qlist = (q, name) => (q.get(name) ?? "").split(/[,|]/).map((s) => s.trim()).filter(Boolean);
const clamp = (q, name, dflt, lo, hi) => Math.min(Math.max(Number(q.get(name) ?? dflt) || dflt, lo), hi);

const tagOf = (jid) => `tag${jid.slice(0, 8)}`;
function titleDto(t, asBoxset = false) {
  const isShow = t.kind === "series";
  return {
    Id: asBoxset ? boxsetJid(t) : t.jid,
    Type: isShow ? "Series" : asBoxset ? "BoxSet" : "Movie",
    Name: t.name,
    Overview: `${t.name}: a perfectly fake ${isShow ? "show" : "film"}.`,
    ProductionYear: 2024,
    CommunityRating: 7.5,
    RunTimeTicks: (isShow ? 45 : 100) * 60 * TICKS,
    Genres: t.genres,
    People: [
      { Name: "Actor A", Type: "Actor" },
      { Name: "Actor B", Type: "Actor" },
      { Name: "Director D", Type: "Director" },
    ],
    ProviderIds: t.stremio.startsWith("tt") ? { Imdb: t.stremio } : {},
    ImageTags: { Primary: tagOf(t.jid) },
    BackdropImageTags: [tagOf(t.jid)],
    // dto.ts:555: the Stremio id is the third segment, a film's name carries the extension.
    Path: `/aiostreams/${isShow ? "series" : "movie"}/${t.stremio}/${t.name}${isShow || asBoxset ? "" : ".mkv"}`,
    UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false },
  };
}
function viewDto(v) {
  return {
    Id: v.id,
    Type: "CollectionFolder",
    Name: v.name,
    IsFolder: true,
    Path: `/aiostreams/${v.type}/${v.cid}`,
    ...(v.required ? { aiostreams: { genreRequired: true } } : {}),
  };
}
function episodeDto(s, e) {
  return {
    Id: e.jid,
    Type: "Episode",
    Name: `Episode ${e.n}`,
    SeriesId: s.jid,
    SeriesName: s.name,
    IndexNumber: e.n,
    ParentIndexNumber: e.season,
    PremiereDate: `2024-0${e.season}-0${e.n}T00:00:00.000Z`,
    Overview: `Season ${e.season}, episode ${e.n}.`,
    RunTimeTicks: 45 * 60 * TICKS,
    ImageTags: { Primary: tagOf(e.jid) },
  };
}

const byJid = new Map(ALL_TITLES.map((t) => [t.jid, t]));
const boxsetByJid = new Map(ALL_TITLES.filter((t) => t.kind === "movie").map((t) => [boxsetJid(t), t]));
const episodeByJid = new Map(
  [SERIES_ONE, SERIES_TWO].flatMap((s) => episodesOf(s).map((e) => [e.jid, e])),
);

/** playback.ts, in the part this app depends on. */
function playbackInfo(jid, body) {
  // A boxset is not resolvable: it never starts a search, and answers a
  // placeholder with NoCompatibleStream (playback.ts ensureMemo).
  if (boxsetByJid.has(jid)) return { status: 200, payload: { MediaSources: [], PlaySessionId: "", ErrorCode: "NoCompatibleStream" } };
  if (!byJid.has(jid) && !episodeByJid.has(jid)) return { status: 404, payload: { MediaSources: [], PlaySessionId: "", ErrorCode: "NotAllowed" } };
  const kept = jf.memo.get(jid);
  const fresh = body?.Fresh === true;
  const refresh = body?.Refresh === true;
  // Unasked, any kept list; Fresh, one no older than the reuse window (180s);
  // Refresh, a new search.
  const rerun = !kept || refresh || (fresh && Date.now() - kept.at > 180_000);
  if (rerun) {
    jf.searches++;
    jf.memo.set(jid, { at: Date.now(), sources: mediaSources(jid) });
  }
  return { status: 200, payload: { MediaSources: jf.memo.get(jid).sources, PlaySessionId: `ps-${jid}` } };
}

/** Requests that carried a credential. The token is the native side's: the
 * page names a path and the Rust side adds it, and images need none. */
const credentials = [];
function jellyfin(rq, rs, path, q, body) {
  if (rq.headers.authorization || [...q.keys()].some((k) => /^(api_?key|token|x-emby-token)$/i.test(k)))
    credentials.push(`${rq.method} ${path}`);
  const send = (status, payload) => {
    rs.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    rs.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  calls.push({ method: rq.method, path, query: Object.fromEntries(q), body });

  let m;
  if (rq.method === "GET" && path === "/UserViews") return send(200, list(viewsNow().map(viewDto)));
  if (rq.method === "GET" && path === "/Genres") {
    const v = viewsNow().find((x) => x.id === q.get("ParentId"));
    return send(200, list((v?.genres ?? []).map((Name) => ({ Name, Type: "Genre" }))));
  }
  if (rq.method === "GET" && path === "/Items") {
    const limit = clamp(q, "Limit", 100, 1, 250);
    const start = Math.max(0, Number(q.get("StartIndex") ?? 0) || 0);
    const parent = q.get("ParentId");
    if (parent) {
      const v = viewsNow().find((x) => x.id === parent);
      if (!v || jf.empty) return send(200, list([], 0, start));
      const genre = qlist(q, "Genres")[0];
      // A library that requires a genre answers nothing without one.
      if (v.required && !genre) return send(200, list([], 0, start));
      const pool = genre ? v.items.filter((t) => t.genres.includes(genre)) : v.items;
      return send(200, list(pool.slice(start, start + limit).map((t) => titleDto(t, !!v.boxset)), pool.length, start));
    }
    const term = (q.get("SearchTerm") ?? "").trim().toLowerCase();
    if (term) {
      const types = qlist(q, "IncludeItemTypes").map((t) => t.toLowerCase());
      const pool = ALL_TITLES.filter(
        (t) =>
          t.name.toLowerCase().includes(term) &&
          (!types.length || types.includes(t.kind === "series" ? "series" : "movie")),
      );
      return send(200, list(pool.slice(start, start + limit).map(titleDto), pool.length, start));
    }
    // The sync's played list and everything else unscoped: nothing.
    return send(200, list([]));
  }
  if (rq.method === "GET" && ["/UserItems/Resume", "/Shows/NextUp", "/Shows/Upcoming"].includes(path)) return send(200, list([]));
  if (rq.method === "GET" && (m = /^\/Shows\/([0-9a-f]{32})\/Episodes$/.exec(path))) {
    const s = byJid.get(m[1]);
    if (!s || s.kind !== "series") return send(404, { Message: "Series not found" });
    const limit = clamp(q, "Limit", 1000, 1, 2000);
    const start = Math.max(0, Number(q.get("StartIndex") ?? 0) || 0);
    const eps = episodesOf(s);
    return send(200, list(eps.slice(start, start + limit).map((e) => episodeDto(s, e)), eps.length, start));
  }
  if (rq.method === "GET" && /^\/Items\/[^/]+\/Images\//.test(path)) {
    rs.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    return rs.end(PNG);
  }
  if (rq.method === "GET" && /^\/MediaSegments\/[0-9a-f]{32}$/.test(path)) return send(200, list([]));
  // A single item. Without Fields, or with MediaSources in it, AIOStreams
  // runs the whole stream search for a film or an episode.
  if (rq.method === "GET" && (m = /^\/Items\/([0-9a-f]{32})$/.exec(path))) {
    const fields = qlist(q, "Fields").map((f) => f.toLowerCase());
    if (!fields.length || fields.includes("mediasources")) violations.push(`GET ${path}${rq.url.includes("?") ? "?" + rq.url.split("?")[1] : ""}`);
    const t = byJid.get(m[1]);
    return t ? send(200, titleDto(t)) : send(404, { Message: "Item not found" });
  }
  if (rq.method === "POST" && (m = /^\/Items\/([0-9a-f]{32})\/PlaybackInfo$/.exec(path))) {
    jf.playbackInfo.push({ id: m[1], body, viaSources: rq.headers["x-aiojf-sources"] === "1" });
    if (rq.headers["x-aiojf-sources"] !== "1") violations.push(`PlaybackInfo ${m[1]} not through aiojf_sources`);
    const r = playbackInfo(m[1], body);
    return send(r.status, r.payload);
  }
  if (rq.method === "POST" && ["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped"].includes(path)) return send(204);
  if (rq.method === "POST" && /^\/UserPlayedItems\//.test(path)) return send(200, { Played: true, PlaybackPositionTicks: 0 });
  return send(404, { Message: "fake jellyfin has no " + path });
}

// ---------------------------------------------------- the Stremio side
// A manifest and one film, for the scenes that read it.
const STREMIO_FILM = "tt0900001";
let PORT = 0;
const addonUrl = (p) => `http://localhost:${PORT}${p}`;
const stremio = {
  manifest: () => ({
    id: "fake.manifest",
    version: "1.0.0",
    name: "Fake Manifest",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: [{ type: "movie", id: "manifest.top", name: "Manifest Movies", extra: [{ name: "skip" }] }],
  }),
  preview: () => ({ id: STREMIO_FILM, type: "movie", name: "Manifest Film", poster: addonUrl("/poster/1.png"), description: "From the manifest." }),
};
/** What the manifest side was asked, to say the Jellyfin side was not. */
const stremioCalls = [];

const server = http.createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    const url = new URL(rq.url, "http://x");
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": rq.headers["access-control-request-headers"] ?? "*",
    };
    if (rq.method === "OPTIONS") {
      rs.writeHead(204, cors);
      return rs.end();
    }
    if (url.pathname.startsWith("/jellyfin/")) {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* not JSON */
      }
      return jellyfin(rq, rs, url.pathname.slice("/jellyfin".length), url.searchParams, body);
    }
    const json = (payload) => {
      rs.writeHead(200, { "content-type": "application/json", ...cors });
      rs.end(JSON.stringify(payload));
    };
    if (url.pathname.startsWith("/poster/")) {
      rs.writeHead(200, { "content-type": "image/png", ...cors });
      return rs.end(PNG);
    }
    const segs = url.pathname.replace(/\.json$/, "").split("/").slice(1).map(decodeURIComponent);
    stremioCalls.push(url.pathname);
    if (segs[0] === "manifest") return json(stremio.manifest());
    if (segs[0] === "catalog") return json({ metas: [stremio.preview()] });
    if (segs[0] === "meta") return json({ meta: { ...stremio.preview(), background: addonUrl("/poster/1.png"), genres: ["Drama"], cast: ["Actor M"] } });
    if (segs[0] === "stream") return json({ streams: [] });
    rs.writeHead(404, cors);
    rs.end("not found");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
PORT = server.address().port;
ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/jellyfin`;
const MANIFEST_URL = `http://localhost:${PORT}/manifest.json`;

// ----------------------------------------------------------- the page
// One stub for every page. `o`: connected (the vault holds a token),
// signedIn (the sign-in this device holds, in the store), manifest (a
// manifest URL is stored), noSources (a native build from before
// aiojf_sources), dead (mpv never presents a frame, for the dead card).
const stub = ({ base, manifest, o }) => {
  window.__calls = [];
  /** aiojf_sources calls: the source opens, as the page asked them. */
  window.__sourceAsks = [];
  let cb = 0;
  const forward = (args, extra = {}) => {
    const q = args.query ? "?" + new URLSearchParams(args.query) : "";
    return fetch(base + args.path + q, {
      method: args.method,
      headers: { "content-type": "application/json", ...extra },
      ...(args.body != null ? { body: JSON.stringify(args.body) } : {}),
    }).then(async (r) => ({ status: r.status, body: await r.text() }));
  };
  // aiojf.rs SOURCE_KEEPS: the only fields of a source the page is given.
  const KEEP = ["Id", "Path", "Name", "Type", "Size", "Container", "RunTimeTicks", "IsInfiniteStream", "aiostreams"];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "aiojf_status")
        return Promise.resolve(o.connected ? { connected: true, userName: "Adam", userId: "u1", base } : { connected: false });
      if (cmd === "aiojf_request") return forward(args);
      if (cmd === "aiojf_sources") {
        if (o.noSources) return Promise.reject("Command aiojf_sources not found");
        // As aiojf.rs: an id that is not 32 lower case hex is refused before a request.
        if (!/^[0-9a-f]{32}$/.test(args.itemId)) return Promise.reject("refused: not an AIOStreams item id");
        window.__sourceAsks.push({ id: args.itemId, refresh: !!args.refresh });
        return fetch(`${base}/Items/${args.itemId}/PlaybackInfo`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aiojf-sources": "1" },
          body: JSON.stringify(args.refresh ? { Refresh: true } : { Fresh: true }),
        }).then(async (r) => {
          const body = await r.json().catch(() => ({}));
          return {
            status: r.status,
            sources: (body.MediaSources ?? []).map((s) => Object.fromEntries(KEEP.filter((k) => k in s).map((k) => [k, s[k]]))),
            ...(body.ErrorCode ? { errorCode: body.ErrorCode } : {}),
          };
        });
      }
      if (cmd === "mpv_status")
        return Promise.resolve(
          JSON.stringify({ pos: o.dead ? 0 : 10, dur: o.dead ? 0 : 6000, presenting: !o.dead, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] }),
        );
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
  if (o.manifest) localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: manifest }));
  if (o.signedIn) localStorage.setItem("blammytv.aiojf", JSON.stringify({ v: 1, data: { signedIn: { base, userName: "Adam" } } }));
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
/** A page in a context of its own: localStorage is shared by every page of
 * one context, and each scene starts from what it seeds. Reduced motion
 * stops the hero's autoplay, so what is on screen holds still to be read. */
async function openPage(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: "reduce" });
  // Every external host is stubbed out: nothing here reaches the network.
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  if (o.clock) await p.clock.install();
  await p.addInitScript(stub, { base: BASE, manifest: MANIFEST_URL, o });
  await p.goto(APP, { waitUntil: "domcontentloaded" });
  return p;
}
const storeOf = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const waitFor = async (p, fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(150);
  }
  return false;
};
const asked = (method, path, pred = () => true) => calls.filter((c) => c.method === method && c.path === path && pred(c));
const rowOf = (p, title) =>
  p.locator(".media-row", { has: p.locator(".media-row__title", { hasText: new RegExp(`^${title}$`) }) });
/** Wake the chrome and leave the player by its Back. */
const leavePlayer = async (p) => {
  const ov = await p.locator(".theater-overlay").first().boundingBox();
  await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await p.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await p.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await p.waitForTimeout(1200);
};
/** Back out of a title's screens to Stream home. */
const toHome = async (p) => {
  for (let i = 0; i < 4 && (await p.locator(".media-row__title", { hasText: /^Trending Movies$/ }).count()) === 0; i++) {
    await p.locator(".vod-back").first().click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(500);
  }
  await p.locator(".media-row__title", { hasText: /^Trending Movies$/ }).first().waitFor({ timeout: 15_000 });
};
const inv = (p) => p.evaluate(() => window.__calls.filter(([c]) => c === "inv_open").map(([, a]) => a));
const opens = (p) => p.evaluate(() => window.__sourceAsks.slice());

// ============================================================ signed in
{
  resetFake();
  const page = await openPage({ connected: true, signedIn: true });
  await page.locator(".media-row__title", { hasText: /^Trending Movies$/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.locator(".media-row__title", { hasText: /^Popular Shows$/ }).first().waitFor({ timeout: 10_000 }).catch(() => {});

  // ------------------------------------------------------------ Stream home
  const titles = await page.locator(".media-row__title").allInnerTexts();
  check(
    "Stream home: a row for each view, in the config's order",
    titles.indexOf("Trending Movies") >= 0 && titles.indexOf("Trending Movies") < titles.indexOf("Popular Shows"),
    JSON.stringify(titles),
  );
  check("  a view whose genre is required is not a row", !titles.includes("By Genre"), JSON.stringify(titles));
  const trending = rowOf(page, "Trending Movies");
  const names = await trending.locator(".stream-card__name").allInnerTexts();
  check(
    "  the row's titles are the instance's, in its order, as many as the row size",
    names.length === 40 && names[0] === "Fake Movie One" && names[1] === "Fake Movie Two" && names[2] === "Addon Only",
    JSON.stringify(names.slice(0, 4)) + ` of ${names.length}`,
  );
  const rowAsk = asked("GET", "/Items", (c) => c.query.ParentId === VIEWS[0].id)[0];
  check(
    "  asked from the view's id, at the row size",
    rowAsk?.query.StartIndex === "0" && rowAsk?.query.Limit === "40" && !("Genres" in rowAsk.query),
    JSON.stringify(rowAsk?.query),
  );
  const posters = await trending.locator("img.stream-card__poster").evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("src")));
  check(
    "  and the posters are on the instance, no token in the address",
    posters.length === 3 && posters.every((s) => s.startsWith(`${BASE}/Items/`) && /\/Images\/Primary\?tag=tag/.test(s) && !/token|api_key/i.test(s)),
    JSON.stringify(posters),
  );
  const shows = await rowOf(page, "Popular Shows").locator(".stream-card__name").allInnerTexts();
  check("  the shows row is its view's shows", JSON.stringify(shows) === JSON.stringify(["Fake Series One", "Fake Series Two"]), JSON.stringify(shows));
  const hero = await page.locator(".shero__card").count();
  const heroArt = await page.locator(".shero__card .shero__art").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  check(
    "  the hero is picked from them, with its art from the instance",
    hero > 0 && heroArt.length > 0 && heroArt.every((s) => s.startsWith(`${BASE}/Items/`) && /\/Images\/Backdrop\/0\?tag=/.test(s)),
    JSON.stringify({ hero, art: heroArt.slice(0, 2) }),
  );
  check("browsing Stream home started no stream search", jf.playbackInfo.length === 0, `${jf.playbackInfo.length} PlaybackInfo`);

  // ------------------------------------------------------------ Discover
  await goTo(page, "discover");
  await page.locator(".genre-card").first().waitFor({ timeout: 20_000 });
  const rail = await page.locator(".genre-card__name").allInnerTexts();
  check(
    "Discover: the genre rail is the views' genres, the required view's left out",
    JSON.stringify([...rail].sort()) === JSON.stringify(["Action", "Comedy", "Drama"]),
    JSON.stringify(rail),
  );
  await page.locator(".genre-card", { hasText: "Action" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length >= 40, null, { timeout: 20_000 }).catch(() => {});
  const g0 = asked("GET", "/Items", (c) => c.query.Genres === "Action" && c.query.StartIndex === "0")[0];
  check(
    "  a genre page asks Genres, from the first title, a page at a time",
    !!g0 && g0.query.ParentId === VIEWS[0].id && g0.query.Limit === "40",
    JSON.stringify(g0?.query),
  );
  await page.locator(".discover__sentinel").scrollIntoViewIfNeeded();
  const more = await waitFor(page, async () => asked("GET", "/Items", (c) => c.query.Genres === "Action" && c.query.StartIndex === "40").length > 0, 15_000);
  const g40 = asked("GET", "/Items", (c) => c.query.Genres === "Action" && c.query.StartIndex === "40")[0];
  check("  and the next page from where the cursor stands", more && g40?.query.ParentId === VIEWS[0].id, JSON.stringify(g40?.query));
  const gridNames = await page.locator(".disc-grid .stream-card__name").allInnerTexts();
  check(
    "  the grid holds only that genre's titles",
    gridNames.length > 40 && !gridNames.includes("Fake Movie Two") && !gridNames.includes("Fake Series One"),
    `${gridNames.length} cards`,
  );
  // Search: the typed text, of each kind, over every library.
  await page.locator(".genre-card--on").first().click().catch(() => {});
  await page.focus(".navcap__searchinput");
  await page.fill(".navcap__searchinput", "fake movie");
  const found = await waitFor(page, async () => (await page.locator(".disc-grid .stream-card__name", { hasText: "Fake Movie One" }).count()) > 0, 15_000);
  const sm = asked("GET", "/Items", (c) => c.query.SearchTerm === "fake movie" && c.query.IncludeItemTypes === "Movie")[0];
  const ss = asked("GET", "/Items", (c) => c.query.SearchTerm === "fake movie" && c.query.IncludeItemTypes === "Series")[0];
  check(
    "  a search asks SearchTerm, once for films and once for shows, over the libraries",
    found && !!sm && !!ss && sm.query.Recursive === "true" && !("ParentId" in sm.query),
    JSON.stringify({ found, movie: sm?.query, series: ss?.query }),
  );
  check("browsing Discover started no stream search", jf.playbackInfo.length === 0, `${jf.playbackInfo.length} PlaybackInfo`);
  await page.fill(".navcap__searchinput", "");
  await goTo(page, "home");
  await page.locator(".media-row__title", { hasText: /^Popular Shows$/ }).first().waitFor({ timeout: 15_000 });

  // ------------------------------------------------------------ a show
  await page.locator('.stream-card[data-hint="Fake Series One"]').first().click({ timeout: 10_000 });
  await page.locator(".episode-card").first().waitFor({ timeout: 20_000 });
  const seasons = await page.evaluate(() => document.body.innerText);
  const epCount = await page.locator(".episode-card").count();
  const epAsk = asked("GET", `/Shows/${SERIES_ONE.jid}/Episodes`)[0];
  check(
    "A show's page: its seasons and episodes, from the instance's episode list",
    /Season 1/.test(seasons) && /Season 2/.test(seasons) && epCount === 3 && !!epAsk && epAsk.query.Limit === "2000",
    JSON.stringify({ epCount, ask: epAsk?.query }),
  );
  const showAsk = asked("GET", `/Items/${SERIES_ONE.jid}`)[0];
  check("  the show itself was asked with Fields", !!showAsk?.query.Fields && !/mediasources/i.test(showAsk.query.Fields), JSON.stringify(showAsk?.query));
  check("  and seeing its episodes started no stream search", jf.playbackInfo.length === 0, `${jf.playbackInfo.length} PlaybackInfo`);
  // Season 2, episode 1: the season bar shows one season at a time.
  await page.locator(".season-bar").getByText("Season 2", { exact: true }).click();
  await page.waitForFunction(() => /E1/.test(document.querySelector(".episode-card")?.textContent ?? ""), null, { timeout: 5000 });
  await page.locator(".episode-card").first().click();
  await page.locator(".vod-source").first().waitFor({ timeout: 20_000 });
  const epAsks = jf.playbackInfo.filter((p) => p.id === episodeJid(SERIES_ONE, 2, 1));
  check(
    "  an episode's sources are asked by its packed id, tt0200001:2:1 as AIOStreams packs it",
    epAsks.length > 0 && epAsks.every((p) => p.body?.Fresh === true),
    JSON.stringify(jf.playbackInfo.map((p) => [p.id.slice(0, 12), p.body])),
  );
  await page.locator('.srclist__group[aria-label^="Cached"] .vod-source').first().click();
  await waitFor(page, async () => (await inv(page)).length > 0, 15_000);
  const wEntry = (await storeOf(page, "watching"))?.[0];
  check(
    "  and playing it keeps the Stremio ids: tt0200001 and the episode tt0200001:2:1",
    wEntry?.id === "tt0200001" && wEntry?.episodeId === "tt0200001:2:1" && wEntry?.season === 2 && wEntry?.episode === 1,
    JSON.stringify(wEntry),
  );
  const epPlay = (await inv(page))[0];
  check("  the player is handed the source's Path as it came", epPlay?.url === pathOf(episodeJid(SERIES_ONE, 2, 1), "a"), epPlay?.url);
  await leavePlayer(page);
  await toHome(page);

  // ------------------------------------------------------------ a film
  await page.locator('.stream-card[data-hint="Fake Movie One"]').first().click({ timeout: 10_000 });
  await page.locator(".vod-source").first().waitFor({ timeout: 20_000 });
  const title = await page.locator(".vod-detail__title, .vod-detail__logo").first().evaluate((e) => e.textContent || e.getAttribute("alt"));
  const meta = await page.locator(".vod-detail__meta").first().innerText();
  const cast = await page.locator(".vod-detail__castline").first().innerText().catch(() => "");
  const synopsis = await page.locator(".vod-detail__synopsis").first().innerText().catch(() => "");
  const pills = await page.locator(".vod-detail__pills button").allInnerTexts();
  check(
    "A film's page: its title, synopsis, cast and genres, from the item",
    title === "Fake Movie One" &&
      synopsis === "Fake Movie One: a perfectly fake film." &&
      cast === "With Actor A, Actor B" &&
      JSON.stringify(pills) === JSON.stringify(["Action", "Drama"]) &&
      /2024/.test(meta) &&
      /100 min/.test(meta) &&
      /7\.5/.test(meta),
    JSON.stringify({ title, meta, cast, synopsis, pills }),
  );
  const filmAsk = asked("GET", `/Items/${ONE.jid}`)[0];
  check("  asked with Fields, never MediaSources", !!filmAsk?.query.Fields && !/mediasources/i.test(filmAsk.query.Fields), JSON.stringify(filmAsk?.query));

  const rows = await page.locator(".vod-source").evaluateAll((els) =>
    els.map((e) => ({
      cache: e.getAttribute("data-cache"),
      quality: e.querySelector(".vod-source__quality")?.textContent,
      lines: [...e.querySelectorAll(".vod-source__lines > span")].map((s) => s.textContent),
    })),
  );
  const groups = await page.locator(".srclist__group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check(
    "Sources: the formatter's own lines, in the server's order inside each group",
    JSON.stringify(rows.map((r) => r.lines)) ===
      JSON.stringify([
        ["Fake.File.2160p.WEB-DL", "8.2 GB | HDR10"],
        ["Fake.File.1080p.WEB-DL", "3.1 GB"],
        ["Direct link", "No cache info"],
        ["Fake.File.1080p.BluRay", "12.4 GB"],
      ]),
    JSON.stringify(rows.map((r) => r.lines)),
  );
  check(
    "  grouped by the instance's cache flag: Cached, then the unmarked, then Not cached",
    JSON.stringify(groups) === JSON.stringify(["Cached, 2", "Other sources, 1", "Not cached, 1"]) &&
      JSON.stringify(rows.map((r) => r.cache)) === JSON.stringify(["cached", "cached", "unknown", "uncached"]),
    JSON.stringify({ groups, cache: rows.map((r) => r.cache) }),
  );
  check(
    "  the quality badge is the bingeGroup's resolution, not read from the name",
    JSON.stringify(rows.map((r) => r.quality)) === JSON.stringify(["2160p", "1080p", "720p", "1080p"]),
    JSON.stringify(rows.map((r) => r.quality)),
  );
  check("  a placeholder source is never shown", rows.length === 4 && !(await page.locator(".vod-source", { hasText: "Statistics" }).count()), `${rows.length} rows`);

  // Play the first cached source.
  const before = (await inv(page)).length;
  await page.locator('.srclist__group[aria-label^="Cached"] .vod-source').first().click();
  await waitFor(page, async () => (await inv(page)).length > before, 15_000);
  const played = (await inv(page)).at(-1);
  check(
    "Play: the player is handed the source's Path, byte for byte",
    played?.url === pathOf(ONE.jid, "a") && played?.live === false,
    JSON.stringify({ got: played?.url, want: pathOf(ONE.jid, "a") }),
  );
  check(
    "  a normal open asks Fresh, never Refresh",
    jf.playbackInfo.length > 0 && jf.playbackInfo.every((p) => p.body?.Fresh === true && !("Refresh" in (p.body ?? {}))),
    JSON.stringify(jf.playbackInfo.map((p) => p.body)),
  );
  await leavePlayer(page);
  await toHome(page);

  // ------------------------------------------------------------ a hashed title
  await page.locator('.stream-card[data-hint="Addon Only"]').first().click({ timeout: 10_000 });
  await page.locator(".vod-source").first().waitFor({ timeout: 20_000 });
  const hashedTitle = await page.locator(".vod-detail__title, .vod-detail__logo").first().evaluate((e) => e.textContent || e.getAttribute("alt"));
  const ids = await storeOf(page, "aiojfIds");
  check(
    "A title with a hashed id opens: its Stremio id came from the list it was in, and is remembered",
    hashedTitle === "Addon Only" && !!asked("GET", `/Items/${HASHED}`)[0] && ids?.pairs?.some(([s, j]) => s === "custom:addon1" && j === HASHED),
    JSON.stringify({ hashedTitle, ids }),
  );
  check(
    "  its sources are asked by the hashed id",
    jf.playbackInfo.some((p) => p.id === HASHED),
    JSON.stringify(jf.playbackInfo.map((p) => p.id.slice(0, 8))),
  );
  const before2 = (await inv(page)).length;
  await page.locator('.srclist__group[aria-label^="Cached"] .vod-source').first().click();
  await waitFor(page, async () => (await inv(page)).length > before2, 15_000);
  check("  and plays through it, the Path as it came", (await inv(page)).at(-1)?.url === pathOf(HASHED, "a"), (await inv(page)).at(-1)?.url);
  // Plan 023's reports name the play by the same id: a title only the id map can
  // name was never reported before the sign-in's lists were consulted.
  const reported = await waitFor(page, async () => asked("POST", "/Sessions/Playing", (c) => c.body?.ItemId === HASHED).length > 0, 15_000);
  check(
    "  and the play is reported to AIOStreams by that id, so it shows in its other apps",
    reported,
    JSON.stringify(asked("POST", "/Sessions/Playing").map((c) => c.body?.ItemId)),
  );
  await leavePlayer(page);

  // ------------------------------------------------------------ the totals
  const asks = await opens(page);
  check(
    "Every PlaybackInfo was a source open (the page asked aiojf_sources for each), and none came any other way",
    jf.playbackInfo.length === asks.length && jf.playbackInfo.every((p) => p.viaSources),
    `${jf.playbackInfo.length} PlaybackInfo, ${asks.length} opens`,
  );
  check(
    "Going back to a title within the window reuses the list: more opens than stream searches",
    jf.searches < jf.playbackInfo.length && jf.searches === new Set(jf.playbackInfo.map((p) => p.id)).size,
    `${jf.searches} searches for ${jf.playbackInfo.length} opens of ${new Set(jf.playbackInfo.map((p) => p.id)).size} items`,
  );
  check("No call that starts AIOStreams' stream search was made but through aiojf_sources", violations.length === 0, JSON.stringify(violations));
  const secret = await page.evaluate(
    () =>
      document.documentElement.innerHTML.includes("SECRET-TOKEN") ||
      Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? "").includes("SECRET-TOKEN")),
  );
  check("  and the page never carried a token, nor holds one it was not given", credentials.length === 0 && !secret, JSON.stringify(credentials));
  await page.context().close();
}

// ============================================================ a catalog named for collections
// AIOStreams lists a plain film in such a catalog as a BoxSet with a packed
// boxset id. That id is not an item (/Items 404s) and never starts a stream
// search, so the app must open and play the film by the id its Stremio id
// computes, and must not learn the boxset id for it.
{
  resetFake();
  jf.extras = true;
  const page = await openPage({ connected: true, signedIn: true });
  await page.locator(".media-row__title", { hasText: /^Movie Collections$/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  const names = await rowOf(page, "Movie Collections").locator(".stream-card__name").allInnerTexts();
  check("A film in a catalog named for collections is still a title on the row", JSON.stringify(names) === JSON.stringify(["Collected Film"]), JSON.stringify(names));
  await page.locator('.stream-card[data-hint="Collected Film"]').first().click({ timeout: 10_000 });
  await page.locator(".vod-source").first().waitFor({ timeout: 20_000 }).catch(() => {});
  const opened = await page.locator(".vod-detail__title, .vod-detail__logo").first().evaluate((e) => e.textContent || e.getAttribute("alt")).catch(() => "");
  check(
    "  it opens: its page is asked by the film's own id, never the boxset id, and has its sources",
    opened === "Collected Film" &&
      asked("GET", `/Items/${COLLECTED.jid}`).length > 0 &&
      asked("GET", `/Items/${boxsetJid(COLLECTED)}`).length === 0 &&
      (await page.locator(".vod-source").count()) > 0,
    JSON.stringify({ opened, asks: calls.filter((c) => /^\/Items\/[0-9a-f]{32}$/.test(c.path)).map((c) => c.path.slice(7, 19)), sources: await page.locator(".vod-source").count() }),
  );
  const before = (await inv(page)).length;
  await page.locator('.srclist__group[aria-label^="Cached"] .vod-source').first().click({ timeout: 5000 }).catch(() => {});
  await waitFor(page, async () => (await inv(page)).length > before, 15_000);
  check(
    "  and plays: the stream search ran for the film's id, and none for the boxset's",
    (await inv(page)).at(-1)?.url === pathOf(COLLECTED.jid, "a") &&
      jf.playbackInfo.some((p) => p.id === COLLECTED.jid) &&
      !jf.playbackInfo.some((p) => p.id === boxsetJid(COLLECTED)),
    JSON.stringify(jf.playbackInfo.map((p) => p.id.slice(0, 8))),
  );
  const learned = (await storeOf(page, "aiojfIds"))?.pairs ?? [];
  check("  and no id was remembered for it, so a stale boxset id cannot stick", !learned.some(([id]) => id === COLLECTED.stremio), JSON.stringify(learned));
  if ((await inv(page)).length > before) await leavePlayer(page);

  // Discover: a catalog that lists no genres is asked by a genre page too.
  await goTo(page, "discover");
  await page.locator(".genre-card").first().waitFor({ timeout: 20_000 });
  await page.locator(".genre-card", { hasText: "Action" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length >= 40, null, { timeout: 20_000 }).catch(() => {});
  const plain = asked("GET", "/Items", (c) => c.query.ParentId === EXTRA_VIEWS[1].id && c.query.Genres === "Action")[0];
  check(
    "Discover: a genre page also asks a catalog that lists no genres, which serves any",
    !!plain && plain.query.StartIndex === "0",
    JSON.stringify(plain?.query),
  );
  // Waited for, not read once: the wait above is for 40 cards, which the
  // first catalog fills alone, and Bagged Film comes from the second. CI
  // read "0 cards" here once (v0.11.22) and four local runs, cold and warm,
  // never did; the detail says what the page held if it happens again.
  const bagged = await waitFor(page, async () => (await page.locator(".disc-grid .stream-card__name", { hasText: "Bagged Film" }).count()) > 0, 15_000);
  const grid = await page.locator(".disc-grid .stream-card__name").allInnerTexts();
  const genreOn = await page.locator(".genre-card--on .genre-card__name").allInnerTexts();
  check("  and its title is on the page", bagged && grid.includes("Bagged Film"), `${grid.length} cards, genre on: ${JSON.stringify(genreOn)}`);
  await page.context().close();
}

// ============================================================ every catalog empty
{
  resetFake();
  jf.empty = true;
  const page = await openPage({ connected: true, signedIn: true });
  // The loading card is a .stream__note too: wait for the one that says so.
  const note = page.locator(".stream__note", { hasText: "Nothing came back" });
  await note.waitFor({ timeout: 30_000 }).catch(() => {});
  const text = (await note.first().innerText().catch(() => "")).replace(/\n/g, " | ");
  check(
    "Signed in with every catalog empty: the empty state talks about the sign-in, not a manifest",
    /Nothing came back from your catalogs/.test(text) &&
      /signed in/.test(text) &&
      /Check your AIOStreams sign-in in Settings → Sources → Stream/.test(text) &&
      !/manifest/i.test(text),
    text,
  );
  await page.context().close();
}

// ============================================================ Retry
{
  resetFake();
  const page = await openPage({ connected: true, signedIn: true, dead: true, clock: true });
  await page.locator('.stream-card[data-hint="Fake Movie Two"]').first().click({ timeout: 30_000 });
  await page.locator(".vod-source").first().waitFor({ timeout: 20_000 });
  await page.locator('.srclist__group[aria-label^="Cached"] .vod-source').first().click();
  await waitFor(page, async () => (await inv(page)).length > 0, 15_000);
  // mpv never presents a frame: the page clock jumps the VOD watchdog's 40s.
  for (let i = 0; i < 6 && (await page.locator(".tune__dead").count()) === 0; i++) await page.clock.runFor(10_000);
  await page.locator(".tune__dead").waitFor({ timeout: 5000 });
  const openedBefore = jf.playbackInfo.length;
  const searchesBefore = jf.searches;
  check(
    "The dead card is up, and every open so far asked Fresh",
    openedBefore > 0 && jf.playbackInfo.every((p) => p.body?.Fresh === true),
    JSON.stringify(jf.playbackInfo.map((p) => p.body)),
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await waitFor(page, async () => jf.playbackInfo.length > openedBefore, 10_000);
  const last = jf.playbackInfo.at(-1);
  check(
    "Retry asks Refresh, once, and AIOStreams searches again",
    jf.playbackInfo.length === openedBefore + 1 && last?.body?.Refresh === true && !("Fresh" in (last?.body ?? {})) && jf.searches === searchesBefore + 1,
    JSON.stringify({ n: jf.playbackInfo.length - openedBefore, body: last?.body, searches: jf.searches - searchesBefore }),
  );
  check("  and that was a source open too", jf.playbackInfo.every((p) => p.viaSources) && violations.length === 0, JSON.stringify(violations));
  await page.context().close();
}

// ============================================================ the hero picker
// Settings → Appearance → Hero Slider Sources lists the catalogs on offer, and
// a required-genre catalog picked as a source is asked with a genre, since
// AIOStreams answers nothing for one without.
{
  resetFake();
  const page = await openPage({ connected: true, signedIn: true });
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const input = page.getByPlaceholder("Add sources…");
  await input.waitFor({ timeout: 15_000 });
  await input.click();
  await page.getByRole("option").first().waitFor({ timeout: 10_000 });
  const options = await page.getByRole("option").allInnerTexts();
  const has = (name) => options.some((t) => t.split("\n")[0].trim() === name);
  check(
    "The hero picker offers the views, and not the search catalogs",
    has("Trending Movies") && has("Popular Shows") && has("By Genre") && options.length === 3,
    JSON.stringify(options),
  );
  await page.getByRole("option", { name: /By Genre/ }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("  and a pick is saved by its type and id", JSON.stringify(await storeOf(page, "heroSources")) === JSON.stringify(["movie/fake.bygenre"]), JSON.stringify(await storeOf(page, "heroSources")));
  resetFake();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".shero__card").first().waitFor({ timeout: 30_000 }).catch(() => {});
  const heroTitles = await page.evaluate(() =>
    [...document.querySelectorAll(".shero__card")].map(
      (c) => c.querySelector(".shero__logo")?.alt ?? c.querySelector(".shero__title")?.textContent ?? "",
    ),
  );
  const forced = asked("GET", "/Items", (c) => c.query.ParentId === VIEWS[2].id)[0];
  check(
    "  a required-genre source is asked with its first genre, and fills the hero",
    forced?.query.Genres === "Western" && heroTitles.length > 0 && heroTitles.every((t) => t === "Western Film"),
    JSON.stringify({ ask: forced?.query, heroTitles }),
  );
  await page.context().close();
}

// ============================================================ not signed in
// The manifest stays as the fallback (D1): signed out, Stream reads it as it
// always did, and the Jellyfin side is never asked.
{
  resetFake();
  stremioCalls.length = 0;
  const page = await openPage({ connected: false, manifest: true });
  await page.locator(".media-row__title", { hasText: /^Manifest Movies$/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  const titles = await page.locator(".media-row__title").allInnerTexts();
  const names = await rowOf(page, "Manifest Movies").locator(".stream-card__name").allInnerTexts();
  check(
    "Signed out with a manifest stored: Stream reads the manifest again",
    titles.includes("Manifest Movies") && !titles.includes("Trending Movies") && names.includes("Manifest Film") && stremioCalls.some((p) => p === "/manifest.json"),
    JSON.stringify({ titles, names }),
  );
  check("  and asks the Jellyfin side for no catalog", asked("GET", "/UserViews").length === 0 && asked("GET", "/Items").length === 0, `${calls.length} calls`);
  check("  nor is a sign-in recorded", !(await storeOf(page, "aiojf"))?.signedIn);
  await page.context().close();
}
{
  // A sign-in the store holds but the vault does not: the status clears it,
  // and the manifest carries Stream from the next load.
  resetFake();
  stremioCalls.length = 0;
  const page = await openPage({ connected: false, signedIn: true, manifest: true });
  const cleared = await waitFor(page, async () => !(await storeOf(page, "aiojf"))?.signedIn, 15_000);
  check("A sign-in the native side no longer holds is cleared from this device", cleared, JSON.stringify(await storeOf(page, "aiojf")));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".media-row__title", { hasText: /^Manifest Movies$/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  check("  and Stream reads the manifest after it", (await page.locator(".media-row__title", { hasText: /^Manifest Movies$/ }).count()) > 0);
  await page.context().close();
}
{
  // Connected, on a native build from before aiojf_sources: it cannot open
  // sources by sign-in, so the manifest carries Stream and nothing is recorded.
  resetFake();
  stremioCalls.length = 0;
  const page = await openPage({ connected: true, noSources: true, manifest: true });
  await page.locator(".media-row__title", { hasText: /^Manifest Movies$/ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500); // the launch sync has read its status by now
  check(
    "A build that cannot open sources stays on the manifest, though it is connected",
    (await page.locator(".media-row__title", { hasText: /^Manifest Movies$/ }).count()) > 0 &&
      !(await storeOf(page, "aiojf"))?.signedIn &&
      asked("GET", "/UserViews").length === 0,
    JSON.stringify(await storeOf(page, "aiojf")),
  );
  await page.context().close();
}
{
  // Connected on a build that can, nothing recorded yet (a sign-in made
  // before this build): the first status read records it.
  resetFake();
  const page = await openPage({ connected: true, manifest: false });
  const recorded = await waitFor(page, async () => (await storeOf(page, "aiojf"))?.signedIn?.base === BASE, 15_000);
  check("A connected status records the sign-in on this device", recorded, JSON.stringify(await storeOf(page, "aiojf")));
  const si = (await storeOf(page, "aiojf"))?.signedIn;
  check("  with the base and the user's name, and no token or id", si?.userName === "Adam" && JSON.stringify(si) === JSON.stringify({ base: BASE, userName: "Adam" }), JSON.stringify(si));
  await page.context().close();
}

check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
