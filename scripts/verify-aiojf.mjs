// E2E: AIOStreams' Jellyfin side (plan 023), with a fake of it in this
// process. The page's aiojf commands (aiojf.rs in the app) are stubbed to
// forward to the fake, the way verify-trakt stubs trakt_request: aiojf.rs's
// own tests cover the token, the header and the guards; this covers what the
// app does with AIOStreams' answers and what it sends.
//
// The fake mirrors AIOStreams v2.35.9 for the routes the app uses (the
// playstate routes, UserPlayedItems, UserItems/Resume, Items?IsPlayed,
// Shows/NextUp and Upcoming, MediaSegments, the item images), including the
// default Limit of 100 on /Items, and RECORDS any `GET /Items/<id>`: on a
// film or an episode that runs AIOStreams' whole stream search, the same
// work as pressing play, so the app must never make one (a check asserts
// zero). It is also its own Stremio addon, on 7-digit IMDb ids: fake-aio's
// ids (tt100001) are not ones AIOStreams would pack, and the packed id is
// the point here. Item ids are packed by an independent pack() below, not by
// the app's.
//
// - Sign-in (Settings → General → Sources → Stream since plan 024; the sync
//   used to have a row of its own under Accounts): the code shows and copies,
//   pending then approved shows the user, expired, an instance with no
//   Jellyfin side, an older native build, and the sign-in offered with no
//   manifest URL stored (it no longer waits for one). verify-signin-ui has the
//   rest of that tab.
// - A film played: Playing, Progress (paused and resumed), Stopped with its
//   packed id and positions; the played mark at the finished line, once,
//   queued when AIOStreams is down and sent at the next sync. An episode the
//   same with its packed episode id. An id that cannot pack sends nothing.
// - A resume point joins Continue Watching; played episodes tick, in a store
//   of their own, read a page at a time (AIOStreams answers at most 250 played
//   items to a request, and holds 500); a played film says Watched. Next Up and
//   Upcoming rows render, and a card opens the show.
// - A Continue Watching card cleared here clears its resume point on AIOStreams
//   (a stop at position 0 through UserItems/<id>/UserData), so the next sync
//   does not bring it back. A finished card is never posted (a stop below the
//   line would un-play it), and signed out nothing is.
// - A skip button from AIOStreams' marker on a film.
// - A 401 shows disconnected; Disconnect clears; changing the AIOStreams URL
//   leaves the sign-in alone (plan 023 signed out there); Clear All Login Info
//   disconnects.
// - Trakt's scrobble still fires alongside.
//
// Offline, as every harness is: every host but localhost is aborted.
//
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-aiojf.mjs
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
// three zero bytes. Checked by hand against the IMDb vector in the plan:
// tt0111161 as a movie is a1110100000001b239ffffffff000000.
const KIND = { movie: 1, series: 2, episode: 4 };
const MEDIA = { movie: 1, series: 2, anime: 3 };
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
function unpackHex(hex) {
  const b = Buffer.from(hex, "hex");
  const kind = Object.keys(KIND).find((k) => KIND[k] === b[1] >> 4);
  const imdb = "tt" + String(b.readUIntBE(3, 6)).padStart(7, "0");
  return { kind, imdb, season: b.readUInt16BE(9), episode: b.readUInt16BE(11) };
}

// ----------------------------------------------------------- the fixtures
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const TICKS = 10_000_000;
const FILMS = {
  tt0100001: { name: "Fake Movie One", year: 2024 },
  tt0100002: { name: "Fake Movie Two", year: 2024 },
  tt555: { name: "Odd Movie", year: 2024 },
  // Only ever a resume point: in no catalog.
  tt0100003: { name: "Fake Movie Three", year: 2024 },
};
// 7-digit ids; Series Two has four episodes in season one, One has a second
// season, Three has one episode that has not aired.
const SHOWS = {
  tt0200001: { name: "Fake Series One", seasons: [3, 3] },
  tt0200002: { name: "Fake Series Two", seasons: [4] },
  tt0200003: { name: "Fake Series Three", seasons: [1] },
  tt0300001: { name: "Long Show", seasons: [] },
};
const ID = {
  one: pack("movie", "tt0100001", "movie"),
  two: pack("movie", "tt0100002", "movie"),
  epOne21: pack("episode", "tt0200001", "series", 2, 1),
  three: pack("movie", "tt0100003", "movie"),
  epTwo14: pack("episode", "tt0200002", "series", 1, 4),
};

// The Jellyfin side's state, one user.
const jf = {
  signedOut: false,
  /** Answer this many UserPlayedItems with a 503. */
  failPlayed: 0,
  // key → when it was last played (ms). Newest first when listed.
  played: new Map([
    ["movie:tt0100001", NOW - 5 * 3600_000],
    ["ep:tt0200002:1:1", NOW - 6 * 3600_000],
    ["ep:tt0200002:1:2", NOW - 7 * 3600_000],
    // More than one /Items answer holds (250 at most), oldest last: the list is
    // read in two pages.
    ...Array.from({ length: 300 }, (_, i) => [`ep:tt0300001:1:${i + 1}`, NOW - (10 + i) * 86400_000]),
  ]),
  // key → { posSec, runSec, at }
  resume: new Map([
    ["movie:tt0100002", { posSec: 2400, runSec: 6000, at: NOW - 1 * 3600_000 }],
    ["ep:tt0200001:2:1", { posSec: 600, runSec: 3000, at: NOW - 2 * 3600_000 }],
  ]),
};
const calls = [];
/** `GET /Items/<id>` on a film or an episode: the stream-search trap. */
const violations = [];
const seen = (method, path) => calls.filter((c) => c.method === method && c.path === path);

const ud = (over = {}) => ({ PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false, ...over });
function filmItem(imdb, userData) {
  return {
    Id: pack("movie", imdb, "movie"),
    Type: "Movie",
    Name: FILMS[imdb].name,
    ProductionYear: FILMS[imdb].year,
    RunTimeTicks: 6000 * TICKS,
    ProviderIds: { Imdb: imdb },
    ImageTags: { Primary: "tagfilm" },
    UserData: userData,
  };
}
function episodeItem(imdb, season, n, userData, extra = {}) {
  return {
    Id: pack("episode", imdb, "series", season, n),
    Type: "Episode",
    Name: `Episode ${n}`,
    SeriesId: pack("series", imdb, "series"),
    SeriesName: SHOWS[imdb].name,
    IndexNumber: n,
    ParentIndexNumber: season,
    RunTimeTicks: 3000 * TICKS,
    SeriesPrimaryImageTag: "tag-" + imdb,
    UserData: userData,
    ...extra,
  };
}
function itemOfKey(key, userData) {
  const [kind, ...rest] = key.split(":");
  if (kind === "movie") return filmItem(rest[0], userData);
  return episodeItem(rest[0], Number(rest[1]), Number(rest[2]), userData);
}
const keyOf = (hex) => {
  const u = unpackHex(hex);
  return u.kind === "movie" ? `movie:${u.imdb}` : `ep:${u.imdb}:${u.season}:${u.episode}`;
};

const list = (items, total = items.length) => ({ Items: items, TotalRecordCount: total, StartIndex: 0 });
const clampLimit = (q, dflt, cap) => Math.min(Math.max(1, Number(q.get("Limit") ?? dflt) || dflt), cap);

/** The Jellyfin routes the app uses, as AIOStreams answers them. */
function jellyfin(rq, rs, path, q, body) {
  const send = (status, payload) => {
    rs.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    rs.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  const rec = { method: rq.method, path, query: Object.fromEntries(q), body };
  calls.push(rec);
  if (jf.signedOut) return send(401, { Message: "Invalid token" });

  let m;
  if (rq.method === "GET" && path === "/UserItems/Resume") {
    const items = [...jf.resume]
      .sort((a, b) => b[1].at - a[1].at)
      .map(([key, r]) =>
        itemOfKey(key, ud({ PlaybackPositionTicks: r.posSec * TICKS, LastPlayedDate: iso(r.at) })),
      );
    return send(200, list(items.slice(0, clampLimit(q, 12, 100)), items.length));
  }
  if (rq.method === "GET" && path === "/Items" && q.get("IsPlayed") === "true") {
    // listPlayed is newest first and never more than 500 (watch-state.ts); a
    // request is answered with at most browseLimit of them (library.ts: 100
    // unasked, 250 at most by default), from StartIndex, with the total.
    const rows = [...jf.played].sort((a, b) => b[1] - a[1]).slice(0, 500);
    const items = rows.map(([key, at]) => itemOfKey(key, ud({ Played: true, PlayCount: 1, LastPlayedDate: iso(at) })));
    const start = Math.max(0, Number(q.get("StartIndex") ?? 0) || 0);
    return send(200, { Items: items.slice(start, start + clampLimit(q, 100, 250)), TotalRecordCount: items.length, StartIndex: start });
  }
  if (rq.method === "GET" && path === "/Shows/NextUp") {
    return send(
      200,
      list([
        episodeItem("tt0200002", 1, 3, ud(), { Name: "Third Time" }),
        // An episode whose id is a hash only AIOStreams can read: it does not decode.
        { ...episodeItem("tt0200002", 1, 4, ud()), Id: "0badc0de" + "0".repeat(24), SeriesId: "0badc0de" + "1".repeat(24) },
      ]),
    );
  }
  if (rq.method === "GET" && path === "/Shows/Upcoming") {
    return send(
      200,
      list([episodeItem("tt0200003", 1, 1, ud(), { Name: "The Premiere", PremiereDate: iso(NOW + 3 * 86400_000) })]),
    );
  }
  if (rq.method === "GET" && (m = /^\/MediaSegments\/([0-9a-f]{32})$/.exec(path))) {
    const items =
      m[1] === ID.two
        ? [
            { Id: "s1", ItemId: m[1], Type: "Intro", StartTicks: 2300 * TICKS, EndTicks: 2500 * TICKS },
            { Id: "s2", ItemId: m[1], Type: "Outro", StartTicks: 5500 * TICKS, EndTicks: 5900 * TICKS },
          ]
        : [];
    return send(200, { Items: items, TotalRecordCount: items.length, StartIndex: 0 });
  }
  if (rq.method === "GET" && /^\/Items\/[^/]+\/Images\/Primary$/.test(path)) {
    rs.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    return rs.end(PNG);
  }
  // The trap: a single item.
  if (rq.method === "GET" && /^\/(Users\/[^/]+\/)?Items\/[^/]+$/.test(path) && !/\/Items\/(Latest|Filters2?|Counts)$/.test(path)) {
    violations.push(`${path}${rq.url.includes("?") ? "?" + rq.url.split("?")[1] : ""}`);
    return send(200, {});
  }
  if (rq.method === "POST" && ["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped"].includes(path)) {
    // Nothing is ever refused: an id it cannot read is a silent 204.
    return send(204);
  }
  if (rq.method === "POST" && (m = /^\/UserPlayedItems\/([0-9a-f]{32})$/.exec(path))) {
    if (jf.failPlayed > 0) {
      jf.failPlayed--;
      return send(503, { Message: "busy" });
    }
    const key = keyOf(m[1]);
    jf.played.set(key, Date.now());
    jf.resume.delete(key);
    return send(200, { Played: true, PlaybackPositionTicks: 0 });
  }
  if (rq.method === "POST" && (m = /^\/UserItems\/([0-9a-f]{32})\/UserData$/.exec(path))) {
    // playstate.ts: a PlaybackPositionTicks is a stop at that position. At 0 it
    // clears the resume point, and a stop under the line writes played: false
    // (local-provider.ts stopPatch), so the item is un-played too.
    if (typeof body?.PlaybackPositionTicks === "number") {
      const key = keyOf(m[1]);
      if (body.PlaybackPositionTicks === 0) jf.resume.delete(key);
      jf.played.delete(key);
    }
    return send(200, { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false });
  }
  return send(404, { Message: "fake jellyfin has no " + path });
}

// A 1x1 PNG for the posters and the item art.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

// ---------------------------------------------------- the Stremio side
const MANIFEST = {
  id: "fake.aiojf",
  version: "1.0.0",
  name: "Fake AIOStreams",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "top-movies", name: "Top Movies", extra: [{ name: "genre", options: ["Action"] }, { name: "skip" }, { name: "search" }] },
    { type: "series", id: "top-series", name: "Top Series", extra: [{ name: "genre", options: ["Drama"] }, { name: "skip" }, { name: "search" }] },
  ],
};
let PORT = 0;
const addonUrl = (p) => `http://localhost:${PORT}${p}`;
const preview = (imdb, type, name) => ({
  id: imdb,
  type,
  name,
  poster: addonUrl(`/poster/${imdb}.png`),
  description: `A perfectly fake ${type}.`,
  genres: [type === "movie" ? "Action" : "Drama"],
});
// Built when asked, not at load: the posters carry the port the server got.
const movieMetas = () => Object.entries(FILMS).map(([id, f]) => preview(id, "movie", f.name));
const allSeries = () =>
  Object.entries(SHOWS)
    .filter(([, s]) => s.seasons.length)
    .map(([id, s]) => preview(id, "series", s.name));
// Series Three is in no catalog: its Upcoming card has only AIOStreams' art.
// Nor is Odd Movie, whose id cannot be packed.
const catalogMovies = () => movieMetas().filter((m) => m.id !== "tt555" && m.id !== "tt0100003");
const catalogSeries = () => allSeries().filter((m) => m.id !== "tt0200003");
function metaOf(type, id) {
  const base = (type === "movie" ? movieMetas() : allSeries()).find((m) => m.id === id);
  if (!base) return null;
  const meta = {
    ...base,
    background: addonUrl(`/poster/${id}.png`),
    runtime: "1h40min",
    releaseInfo: "2024",
    genres: ["Action", "Drama"],
    cast: ["Actor A"],
  };
  if (type === "series") {
    meta.videos = [];
    SHOWS[id].seasons.forEach((count, s) => {
      for (let e = 1; e <= count; e++) {
        const future = id === "tt0200003";
        meta.videos.push({
          id: `${id}:${s + 1}:${e}`,
          season: s + 1,
          episode: e,
          name: `Episode ${e}`,
          released: future ? iso(NOW + 3 * 86400_000) : `2024-01-0${e}T00:00:00Z`,
        });
      }
    });
  }
  return meta;
}
const streams = (id) => [
  {
    name: "⚡ 4K | Debrid",
    description: "Fake 4K\n8.2GB ⚡",
    url: addonUrl(`/video/${encodeURIComponent(id)}-4k.mp4`),
    behaviorHints: { bingeGroup: "fake|2160p" },
  },
];

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
    if (url.pathname.startsWith("/video/")) {
      rs.writeHead(200, { "content-type": "video/mp4", ...cors });
      return rs.end(Buffer.from("FAKE-MP4-BYTES"));
    }
    const segs = url.pathname.replace(/\.json$/, "").split("/").slice(1).map(decodeURIComponent);
    if (segs[0] === "manifest") return json(MANIFEST);
    if (segs[0] === "catalog") {
      if (segs[1] === "movie") return json({ metas: catalogMovies() });
      if (segs[1] === "series") return json({ metas: catalogSeries() });
    }
    if (segs[0] === "meta") {
      const meta = metaOf(segs[1], segs[2]);
      if (meta) return json({ meta });
    }
    if (segs[0] === "stream") return json({ streams: streams(segs[2]) });
    rs.writeHead(404, cors);
    rs.end("not found");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
PORT = server.address().port;
const MANIFEST_URL = `http://localhost:${PORT}/manifest.json`;
const BASE = `http://127.0.0.1:${PORT}/jellyfin`;

// ----------------------------------------------------------- the page
// One stub for every page. `o`: connected (the vault holds a token), start
// (what aiojf_start does), poll (what the Quick Connect poll does), old (a
// native build from before aiojf.rs), canSource (a build that has
// aiojf_sources, so a new sign-in is on offer: aiojfCanSource() calls it with
// an id it refuses; the default build here cannot, and stays on the manifest),
// watching (Continue Watching entries to start with), trakt (a fake Trakt that
// records).
const stub = ({ base, manifest, o }) => {
  window.__pos = 2400;
  window.__dur = 6000;
  window.__calls = [];
  window.__trakt = [];
  window.__copied = [];
  window.__aioConnected = !!o.connected;
  let polls = 0;
  let cb = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t) => (window.__copied.push(t), Promise.resolve()) },
  });
  const forward = (args) => {
    const q = args.query ? "?" + new URLSearchParams(args.query) : "";
    return fetch(base + args.path + q, {
      method: args.method,
      headers: { "content-type": "application/json" },
      ...(args.body != null ? { body: JSON.stringify(args.body) } : {}),
    }).then(async (r) => {
      // As the native side does: a 401 drops the token.
      if (r.status === 401) window.__aioConnected = false;
      return { status: r.status, body: await r.text() };
    });
  };
  const traktReply = (args) => {
    const body = args.body ? JSON.parse(args.body) : null;
    window.__trakt.push({ method: args.method, path: args.path, body });
    const json = (status, payload) => ({ status, body: JSON.stringify(payload), retry_after: null, account_limit: null, upgrade_url: null });
    if (args.path === "/sync/last_activities") return json(200, {});
    if (args.method === "GET" && args.path.startsWith("/sync/")) return json(200, []);
    const ep = /^\/shows\/(tt\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(args.path);
    if (ep) return json(200, { ids: { trakt: 9000 + Number(ep[3]) } });
    const sc = /^\/scrobble\/(start|pause|stop)$/.exec(args.path);
    if (sc) return json(201, { action: sc[1] === "stop" && body.progress > 80 ? "scrobble" : sc[1] });
    return json(404, {});
  };
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
      if (cmd.startsWith("aiojf_") && o.old) return Promise.reject(`Command ${cmd} not found`);
      if (cmd === "aiojf_status")
        return Promise.resolve(
          window.__aioConnected ? { connected: true, userName: "Adam", userId: "u1", base } : { connected: false },
        );
      if (cmd === "aiojf_start") {
        if (o.start === "unsupported") return Promise.reject("unsupported: no Jellyfin side on this instance");
        return Promise.resolve({ code: "123456", expiresIn: 600, configureUrl: manifest.replace("manifest.json", "configure") });
      }
      if (cmd === "aiojf_poll") {
        if (o.poll === "expire") return Promise.resolve("expired");
        if (++polls < 2) return Promise.resolve("pending");
        window.__aioConnected = true;
        return Promise.resolve("approved");
      }
      if (cmd === "aiojf_disconnect") {
        window.__aioConnected = false;
        return Promise.resolve();
      }
      if (cmd === "aiojf_request") return forward(args);
      if (cmd === "aiojf_sources" && o.canSource) return Promise.reject("refused: not an AIOStreams item id");
      if (o.trakt && cmd === "trakt_status") return Promise.resolve({ configured: true, connected: true });
      if (o.trakt && cmd === "trakt_request") return Promise.resolve(traktReply(args));
      if (cmd === "mpv_status")
        return Promise.resolve(
          JSON.stringify({ pos: window.__pos, dur: window.__dur, presenting: true, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] }),
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
  if (o.url !== false) localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: manifest }));
  if (o.watching) localStorage.setItem("blammytv.watching", JSON.stringify({ v: 1, data: o.watching }));
  if (o.seedWatching)
    localStorage.setItem(
      "blammytv.watching",
      JSON.stringify({
        v: 1,
        data: [{ id: "tt555", title: "Odd Movie", kind: "movie", at: Date.now() - 3 * 86400_000, posSec: 1200, durSec: 6000 }],
      }),
    );
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
/** A page in a context of its own: localStorage is shared by every page of
 * one context, and each scenario here starts from what it seeds. */
async function openPage(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.logs = [];
  p.on("console", (m) => p.logs.push(m.text()));
  await p.addInitScript(stub, { base: BASE, manifest: MANIFEST_URL, o });
  await p.goto(APP, { waitUntil: "domcontentloaded" });
  return p;
}
const storeOf = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const waitFor = async (p, fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(200);
  }
  return false;
};
const openSettings = async (p) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 15_000 });
  await p.locator(".trakt-row").first().waitFor({ timeout: 10_000 });
};
/** Settings on General → Sources → Stream, where the sign-in is. */
const openAioTab = async (p) => {
  await openSettings(p);
  await p.locator(".customize-rail").getByRole("tab", { name: "Stream", exact: true }).click();
  await p.locator(".settings-section").first().waitFor({ timeout: 10_000 });
};
const closeSettings = async (p) => {
  await p.keyboard.press("Escape");
  await p.locator(".trakt-row").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
};
/** Wake the chrome and leave the player by its Back. */
const leavePlayer = async (p) => {
  const ov = await p.locator(".theater-overlay").first().boundingBox();
  await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await p.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await p.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await p.waitForTimeout(1500);
};
const sessionCalls = (suffix = "") => calls.filter((c) => c.method === "POST" && c.path === "/Sessions/Playing" + suffix);

// ------------------------------------------------------------ the launch sync
const page = await openPage({ connected: true, trakt: true, seedWatching: true });
await waitFor(page, async () => !!(await storeOf(page, "aiojf"))?.lastSync, 15_000);
check(
  "the sync asks each list route with ProviderIds, and never for a single item",
  ["/UserItems/Resume", "/Items", "/Shows/NextUp", "/Shows/Upcoming"].every(
    (p) => seen("GET", p).length > 0 && seen("GET", p).every((c) => c.query.Fields === "ProviderIds"),
  ),
  JSON.stringify(calls.filter((c) => c.method === "GET").map((c) => [c.path, c.query.Fields])),
);

const cw = await storeOf(page, "watching");
const two = cw?.find((e) => e.id === "tt0100002");
const epOne = cw?.find((e) => e.id === "tt0200001");
check(
  "a film AIOStreams has half watched joins Continue Watching at its position",
  !!two && two.posSec === 2400 && two.durSec === 6000 && two.title === "Fake Movie Two" && two.kind === "movie",
  JSON.stringify(two),
);
check(
  "  and so does an episode, with its label",
  !!epOne && epOne.episodeId === "tt0200001:2:1" && epOne.posSec === 600 && epOne.season === 2 && epOne.episode === 1 && epOne.title === "Fake Series One",
  JSON.stringify(epOne),
);
await page.locator(".continue-card", { hasText: "Fake Movie Two" }).first().waitFor({ timeout: 10_000 }).catch(() => {});
check(
  "  both on the Continue Watching row, the one already there still with them",
  (await page.locator(".continue-card", { hasText: "Fake Movie Two" }).count()) > 0 &&
    (await page.locator(".continue-card", { hasText: "Fake Series One" }).count()) > 0 &&
    (await page.locator(".continue-card", { hasText: "Odd Movie" }).count()) > 0,
);

const played = await storeOf(page, "aioWatched");
check(
  "what AIOStreams has as played is stored apart, films and episodes",
  JSON.stringify(played?.episodes?.tt0200002) === JSON.stringify(["tt0200002:1:1", "tt0200002:1:2"]) && JSON.stringify(played?.films) === JSON.stringify(["tt0100001"]),
  JSON.stringify({ two: played?.episodes?.tt0200002, films: played?.films }),
);
check(
  "  past the 250 AIOStreams answers at once: all 300 of a long show's are there",
  played?.episodes?.tt0300001?.length === 300,
  `${played?.episodes?.tt0300001?.length} of 300`,
);
const playedAsks = seen("GET", "/Items").filter((c) => c.query.IsPlayed === "true");
check(
  "  because the list is read a page at a time: StartIndex 0, then 250, and no third",
  JSON.stringify(playedAsks.slice(0, 2).map((c) => [c.query.StartIndex, c.query.Limit])) === JSON.stringify([["0", "500"], ["250", "250"]]) &&
    playedAsks.length === 2,
  JSON.stringify(playedAsks.map((c) => [c.query.StartIndex, c.query.Limit])),
);
check("  and the ledger Trakt replaces is not where they are", !(await storeOf(page, "watchedEpisodes"))?.tt0200002);

const aio = await storeOf(page, "aiojf");
check(
  "Next Up and Upcoming are stored as cards, what did not decode left out",
  aio?.nextUp?.length === 1 && aio.nextUp[0].seriesId === "tt0200002" && aio.nextUp[0].episodeId === "tt0200002:1:3" && aio?.upcoming?.length === 1 && aio.upcoming[0].seriesId === "tt0200003",
  JSON.stringify({ nextUp: aio?.nextUp, upcoming: aio?.upcoming }),
);
const line = page.logs.find((l) => l.startsWith("[aiojf] sync:"));
check(
  "the sync logs one line: counts, and how many items did not decode",
  !!line && /2 resume/.test(line) && /302 episodes and 1 films played/.test(line) && /1 didn't decode/.test(line),
  line,
);

// ------------------------------------------------------------ the rows
const rowTitles = await page.locator(".media-row__title").allInnerTexts();
const iNext = rowTitles.indexOf("Next Up");
check(
  "Next Up and Upcoming rows sit under Continue Watching",
  rowTitles.indexOf("Continue Watching") >= 0 && iNext === rowTitles.indexOf("Continue Watching") + 1 && rowTitles[iNext + 1] === "Upcoming",
  JSON.stringify(rowTitles),
);
const nextRow = page.locator(".media-row", { has: page.locator(".media-row__title", { hasText: /^Next Up$/ }) });
const upRow = page.locator(".media-row", { has: page.locator(".media-row__title", { hasText: /^Upcoming$/ }) });
const nextText = await nextRow.innerText();
const upText = await upRow.innerText();
check(
  "  Next Up names the show and the episode, Upcoming the day it airs",
  /Fake Series Two/.test(nextText) && /S1 · E3: Third Time/.test(nextText) && /Fake Series Three/.test(upText) && /[A-Z][a-z]{2} \d{1,2} · S1 · E1: The Premiere/.test(upText),
  JSON.stringify({ nextText, upText }),
);
// The show is in the catalog, so its card wears the catalog's poster; the
// one that is not would wear AIOStreams' art, from the base, no token.
const arts = await upRow.locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
check(
  "  the art of a show outside the catalog comes from AIOStreams' base, no token in it",
  arts.length === 1 && arts[0].startsWith(`${BASE}/Items/`) && /\/Images\/Primary\?tag=tag-tt0200003$/.test(arts[0]) && !/token/i.test(arts[0]),
  JSON.stringify(arts),
);
if (process.env.SHOT_DIR) {
  await upRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/aiojf-rows.png` });
}

// A card opens that show's page, ticks on it.
await nextRow.locator(".stream-card", { hasText: "Fake Series Two" }).click();
await page.locator(".vod-detail__title, .vod-detail__logo").first().waitFor({ timeout: 10_000 });
const title = await page.locator(".vod-detail__title").first().innerText().catch(() => "");
check("a Next Up card opens that show's episode page", title === "Fake Series Two" && (await page.locator(".episode-card").count()) > 0, title);
const ticked = await page.locator(".episode-card", { has: page.locator(".episode-card__seen") }).allInnerTexts();
check(
  "  its first two episodes, which AIOStreams has as played, tick",
  ticked.length === 2 && /E1/.test(ticked[0]) && /E2/.test(ticked[1]),
  JSON.stringify(ticked),
);
check(
  "  and the third, the one after them, is the one marked next",
  /E3/.test(await page.locator(".episode-card.is-next").first().innerText().catch(() => "")),
);
await page.locator(".vod-back").first().click({ timeout: 5000 });
await page.locator(".media-row__title", { hasText: /^Next Up$/ }).first().waitFor({ timeout: 10_000 });

// And a show that is in no catalog opens too, by its id, as Continue Watching
// opens one.
await upRow.locator(".stream-card", { hasText: "Fake Series Three" }).click();
await page.locator(".vod-detail__title").first().waitFor({ timeout: 10_000 });
await page.locator(".episode-card").first().waitFor({ timeout: 10_000 }).catch(() => {});
const title3 = await page.locator(".vod-detail__title").first().innerText().catch(() => "");
check("an Upcoming card for a show in no catalog opens its episode page too", title3 === "Fake Series Three" && (await page.locator(".episode-card").count()) === 1, title3);
await page.locator(".vod-back").first().click({ timeout: 5000 });
await page.locator(".media-row__title", { hasText: /^Upcoming$/ }).first().waitFor({ timeout: 10_000 });

// A film AIOStreams has as played says Watched.
await page.locator('.stream-card[data-hint="Fake Movie One"]').first().click({ timeout: 10_000 });
await page.locator(".vod-detail__meta").first().waitFor({ timeout: 10_000 });
const meta = await page.locator(".vod-detail__meta").first().innerText();
check("a film AIOStreams has as played shows the film page's Watched mark", /Watched/.test(meta), meta);
await page.locator(".vod-back").first().click({ timeout: 5000 });
await goTo(page, "home");

// ------------------------------------------------------------ a film played
const filmCard = page.locator(".continue-card", { hasText: "Fake Movie Two" }).first();
await filmCard.waitFor({ timeout: 10_000 });
await page.waitForTimeout(800);
jf.failPlayed = 1; // AIOStreams is down for the played mark the first time
await filmCard.click();
const started = await waitFor(page, async () => sessionCalls().length > 0, 25_000);
const playing = sessionCalls()[0]?.body;
check(
  "playing a film reports Playing with its packed id and where it starts",
  started && playing?.ItemId === ID.two && playing?.PositionTicks === 2400 * TICKS && playing?.IsPaused === false,
  JSON.stringify(playing),
);
// The skip button from AIOStreams' Intro marker (2300s to 2500s), on a title
// that is not anime.
await page.evaluate(() => (window.__pos = 2410));
const chip = await waitFor(page, async () => (await page.locator(".skip-chip").count()) > 0, 10_000);
const chipText = chip ? (await page.locator(".skip-chip").first().innerText()).trim() : "";
check(
  "a skip button comes from AIOStreams' marker on a film",
  chipText === "Skip Intro" && seen("GET", `/MediaSegments/${ID.two}`).length === 1 && seen("GET", `/MediaSegments/${ID.two}`)[0].query.includeSegmentTypes === "Intro,Recap,Outro",
  JSON.stringify({ chipText, asked: seen("GET", `/MediaSegments/${ID.two}`).map((c) => c.query) }),
);

const progress = () => sessionCalls("/Progress");
await waitFor(page, async () => progress().length >= 1, 15_000);
check(
  "  Progress follows every 10s with the position",
  progress()[0]?.body?.ItemId === ID.two && progress()[0].body.PositionTicks === 2410 * TICKS && progress()[0].body.IsPaused === false,
  JSON.stringify(progress()[0]?.body),
);
// The position holds still: a pause.
await waitFor(page, async () => progress().length >= 2, 15_000);
check("  a position that stops moving is a Progress with IsPaused", progress()[1]?.body?.IsPaused === true, JSON.stringify(progress()[1]?.body));
await page.evaluate(() => (window.__pos = 2440));
await waitFor(page, async () => progress().length >= 3, 15_000);
check("  and moving again, one with IsPaused false", progress()[2]?.body?.IsPaused === false && progress()[2].body.PositionTicks === 2440 * TICKS, JSON.stringify(progress()[2]?.body));

// Past the app's own line (90%).
await page.evaluate(() => (window.__pos = 5700));
const stopped = await waitFor(page, async () => sessionCalls("/Stopped").length > 0, 15_000);
const stop = sessionCalls("/Stopped")[0]?.body;
check(
  "past 90% the stop goes out while it still plays, with the position and the packed id",
  stopped && stop?.ItemId === ID.two && stop.PositionTicks === 5700 * TICKS,
  JSON.stringify(stop),
);
const marks = () => calls.filter((c) => c.method === "POST" && c.path === `/UserPlayedItems/${ID.two}`);
await waitFor(page, async () => marks().length > 0, 5000);
check("  and the played mark is sent once, after the stop", marks().length === 1 && calls.indexOf(marks()[0]) > calls.indexOf(sessionCalls("/Stopped")[0]), `${marks().length} marks`);
const queued = await waitFor(page, async () => (await storeOf(page, "aiojfQueue"))?.includes(ID.two), 3000);
check("  AIOStreams was down for it, so the mark is queued", queued, JSON.stringify(await storeOf(page, "aiojfQueue")));
const trakt = await page.evaluate(() => window.__trakt.filter((t) => t.path.startsWith("/scrobble/")).map((t) => [t.path, t.body.movie?.ids?.imdb, Math.round(t.body.progress)]));
check(
  "Trakt's own scrobble fires alongside, for the same play",
  trakt.some(([p, id]) => p === "/scrobble/start" && id === "tt0100002") && trakt.some(([p, id, pct]) => p === "/scrobble/stop" && id === "tt0100002" && pct >= 90),
  JSON.stringify(trakt),
);
await leavePlayer(page);
check(
  "leaving afterwards sends no second stop and no second mark",
  sessionCalls("/Stopped").length === 1 && marks().length === 1,
  `${sessionCalls("/Stopped").length} stops, ${marks().length} marks`,
);

// Sync now: the queued mark goes first, and what comes back includes it.
await openAioTab(page);
const row = page.locator(".aio-row");
await row.getByRole("button", { name: "Sync now" }).waitFor({ timeout: 8000 });
check("Settings names the account AIOStreams signed in", /Signed in as Adam/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, " | "));
check(
  "  and says so once about Trakt trackers",
  /Leave any Trakt tracker out of your AIOStreams setup, or each play counts twice\./.test(await row.innerText()),
);
if (process.env.SHOT_DIR) await page.locator(".settings-section", { has: row }).first().screenshot({ path: `${process.env.SHOT_DIR}/aiojf-connected.png` });
await row.getByRole("button", { name: "Sync now" }).click();
const drained = await waitFor(page, async () => marks().length === 2, 10_000);
check("Sync now sends the queued played mark again", drained, `${marks().length} marks`);
await waitFor(page, async () => ((await storeOf(page, "aiojfQueue")) ?? []).length === 0, 5000);
check("  and the queue empties", ((await storeOf(page, "aiojfQueue")) ?? []).length === 0, JSON.stringify(await storeOf(page, "aiojfQueue")));
const after = await waitFor(page, async () => (await storeOf(page, "aioWatched"))?.films?.includes("tt0100002"), 10_000);
check("  and the list that comes back has the film played", after, JSON.stringify((await storeOf(page, "aioWatched"))?.films));
await closeSettings(page);

// ------------------------------------------------------------ an episode played
await page.evaluate(() => {
  window.__pos = 600;
  window.__dur = 3000;
});
const epCard = page.locator(".continue-card", { hasText: "Fake Series One" }).first();
await epCard.waitFor({ timeout: 10_000 });
await epCard.click();
const epStarted = await waitFor(page, async () => sessionCalls().length > 1, 25_000);
const epPlaying = sessionCalls()[1]?.body;
check(
  "playing an episode reports Playing with its packed episode id",
  epStarted && epPlaying?.ItemId === ID.epOne21 && epPlaying.PositionTicks === 600 * TICKS,
  JSON.stringify(epPlaying),
);
await page.evaluate(() => (window.__pos = 2800));
const epStopped = await waitFor(page, async () => sessionCalls("/Stopped").length > 1, 15_000);
const epMarks = () => calls.filter((c) => c.method === "POST" && c.path === `/UserPlayedItems/${ID.epOne21}`);
await waitFor(page, async () => epMarks().length > 0, 5000);
check(
  "  past 90% the stop and the played mark carry the episode's id",
  epStopped && sessionCalls("/Stopped")[1]?.body?.ItemId === ID.epOne21 && sessionCalls("/Stopped")[1].body.PositionTicks === 2800 * TICKS && epMarks().length === 1,
  JSON.stringify({ stop: sessionCalls("/Stopped")[1]?.body, marks: epMarks().length }),
);
await leavePlayer(page);
check("  and leaving afterwards sends nothing more", sessionCalls("/Stopped").length === 2 && epMarks().length === 1);

// ------------------------------------------------------------ past the line between two looks
// Crossing 90% and leaving before the next 10s look (a seek to the end, a
// next-episode jump) is a finish too, read from Continue Watching on the
// way out, as Trakt's scrobble does.
const epOne22 = pack("episode", "tt0200001", "series", 2, 2);
await page.evaluate(() => {
  window.__pos = 300;
  window.__dur = 3000;
});
await epCard.click();
const ep2Started = await waitFor(page, async () => sessionCalls().some((c) => c.body?.ItemId === epOne22), 25_000);
await page.evaluate(() => (window.__pos = 2900));
const ep2Entry = await waitFor(
  page,
  async () => ((await storeOf(page, "watching")) ?? []).some((w) => w.episodeId === "tt0200001:2:2" && w.posSec === 2900),
  8000,
);
const stopsBeforeLeave = sessionCalls("/Stopped").length;
await leavePlayer(page);
const ep2Marks = () => calls.filter((c) => c.method === "POST" && c.path === `/UserPlayedItems/${epOne22}`);
await waitFor(page, async () => ep2Marks().length > 0, 5000);
const ep2Stop = sessionCalls("/Stopped").find((c) => c.body?.ItemId === epOne22)?.body;
check(
  "past 90% since the last look, leaving sends the stop and the played mark",
  ep2Started && ep2Entry && stopsBeforeLeave === 2 && ep2Stop?.PositionTicks === 2900 * TICKS && ep2Marks().length === 1,
  JSON.stringify({ ep2Started, ep2Entry, stopsBeforeLeave, stop: ep2Stop, marks: ep2Marks().length }),
);

// ------------------------------------------------------------ an id that cannot pack
await page.evaluate(() => {
  window.__pos = 1200;
  window.__dur = 6000;
});
const sessionsBefore = calls.filter((c) => c.path.startsWith("/Sessions/")).length;
const oddCard = page.locator(".continue-card", { hasText: "Odd Movie" }).first();
await oddCard.waitFor({ timeout: 10_000 });
await oddCard.click();
// The play happened: Trakt, which takes any IMDb id, heard of it.
const oddPlayed = await waitFor(page, async () => (await page.evaluate(() => window.__trakt.some((t) => t.path === "/scrobble/start" && t.body.movie?.ids?.imdb === "tt555"))), 25_000);
await page.waitForTimeout(1500);
check(
  "a title whose id cannot be packed sends nothing, and is counted",
  oddPlayed && calls.filter((c) => c.path.startsWith("/Sessions/")).length === sessionsBefore && (await storeOf(page, "aiojf"))?.unpackable === 1,
  JSON.stringify({ oddPlayed, sessions: calls.filter((c) => c.path.startsWith("/Sessions/")).length - sessionsBefore, unpackable: (await storeOf(page, "aiojf"))?.unpackable }),
);
await leavePlayer(page);

// ------------------------------------------------------------ the trap
check(
  "the app never asked for a single item (GET /Items/<id>), in a sync or a play",
  violations.length === 0 && seen("GET", "/Items").length >= 2,
  JSON.stringify(violations),
);

// ------------------------------------------------------------ a 401
await openAioTab(page);
jf.signedOut = true;
await page.locator(".aio-row").getByRole("button", { name: "Sync now" }).click();
// This stub is a build that cannot open sources, so a new sign-in is not offered
// once it is signed out (plan 024): the signed-in row going is how it shows.
// The connecting scenes below, whose stub can, check for Connect.
const off = await page.locator(".aio-row").waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
const cleared = {
  played: await storeOf(page, "aioWatched"),
  aiojf: await storeOf(page, "aiojf"),
  queue: await storeOf(page, "aiojfQueue"),
};
check(
  "a 401 shows it disconnected, and what it held goes",
  off && !cleared.played && Object.keys(cleared.aiojf ?? {}).length === 0 && (cleared.queue ?? []).length === 0,
  JSON.stringify({ off, ...cleared }),
);
jf.signedOut = false;
await closeSettings(page);
check(
  "  the home rows go with it, Continue Watching keeps what it merged",
  (await page.locator(".media-row__title", { hasText: /^(Next Up|Upcoming)$/ }).count()) === 0 && (await page.locator(".continue-card", { hasText: "Fake Series One" }).count()) > 0,
);
check("no page errors in the app", errors.length === 0, errors.slice(0, 2).join(" | "));
await page.close();

// ------------------------------------------------------------ clearing a card
// A card cleared here clears its resume point on AIOStreams: a stop at
// position 0 through UserItems/<id>/UserData, the film's own id or the
// episode's. Left, the next sync brings the card straight back.
const userData = () => calls.filter((c) => c.method === "POST" && /^\/UserItems\/[0-9a-f]{32}\/UserData$/.test(c.path));
{
  // Two resume points nothing above touches: a film, and a show's episode.
  jf.resume.set("movie:tt0100003", { posSec: 1800, runSec: 6000, at: NOW - 30 * 60_000 });
  jf.resume.set("ep:tt0200002:1:4", { posSec: 900, runSec: 3000, at: NOW - 40 * 60_000 });
  const p = await openPage({ connected: true });
  const filmCard = p.locator(".continue-card", { hasText: "Fake Movie Three" }).first();
  const showCard = p.locator(".continue-card", { hasText: "Fake Series Two" }).first();
  await filmCard.waitFor({ timeout: 20_000 });
  await showCard.waitFor({ timeout: 20_000 });
  const asksBefore = userData().length;
  await filmCard.focus();
  await p.keyboard.press("Delete");
  await waitFor(p, async () => userData().length > asksBefore, 8000);
  const film = userData()[asksBefore];
  check(
    "clearing a film's card posts position 0 to its own id on AIOStreams",
    userData().length === asksBefore + 1 && film?.path === `/UserItems/${ID.three}/UserData` && film.body?.PlaybackPositionTicks === 0,
    JSON.stringify(film),
  );
  await showCard.focus();
  await p.keyboard.press("Delete");
  await waitFor(p, async () => userData().length > asksBefore + 1, 8000);
  const ep = userData()[asksBefore + 1];
  check(
    "  and a show's card clears the episode's id, not the show's",
    userData().length === asksBefore + 2 && ep?.path === `/UserItems/${ID.epTwo14}/UserData` && ep.body?.PlaybackPositionTicks === 0,
    JSON.stringify(ep),
  );
  check("  AIOStreams took them: neither resume point is left there", !jf.resume.has("movie:tt0100003") && !jf.resume.has("ep:tt0200002:1:4"));
  // Sync now: with the points cleared there, the cards stay gone.
  await openAioTab(p);
  const resumeReads = seen("GET", "/UserItems/Resume").length;
  await p.locator(".aio-row").getByRole("button", { name: "Sync now" }).click();
  await waitFor(p, async () => seen("GET", "/UserItems/Resume").length > resumeReads, 10_000);
  await p.waitForTimeout(800);
  await closeSettings(p);
  const left = ((await storeOf(p, "watching")) ?? []).filter((w) => w.id === "tt0100003" || w.id === "tt0200002");
  check(
    "a cleared card stays gone after Sync now",
    seen("GET", "/UserItems/Resume").length > resumeReads && left.length === 0 && (await p.locator(".continue-card", { hasText: /Fake Movie Three|Fake Series Two/ }).count()) === 0,
    JSON.stringify(left),
  );
  await p.close();
}
{
  // Library → clear history takes every card at once, finished ones included.
  // A finished one is never posted: a stop below the line would write
  // played: false, and a played mark is never removed from here (plan 023, D3).
  const watching = [
    { id: "tt0100001", title: "Fake Movie One", kind: "movie", at: NOW - 3600_000, posSec: 5700, durSec: 6000 },
    { id: "tt0100003", title: "Fake Movie Three", kind: "movie", at: NOW - 7200_000, posSec: 1800, durSec: 6000 },
  ];
  const p = await openPage({ connected: true, watching });
  await goTo(p, "mylist");
  await p.locator('.library__card[data-hint="Library"]').first().click({ timeout: 15_000 });
  const before = userData().length;
  const clear = p.getByRole("button", { name: "Clear history", exact: true });
  await clear.click();
  await p.getByRole("button", { name: "Click again to confirm" }).click();
  await waitFor(p, async () => userData().length > before, 8000);
  await p.waitForTimeout(1200);
  const posted = userData().slice(before);
  check(
    "clearing the history posts only the unfinished card: the finished film is never posted",
    JSON.stringify(posted.map((c) => c.path)) === JSON.stringify([`/UserItems/${ID.three}/UserData`]),
    JSON.stringify(posted.map((c) => c.path)),
  );
  check("  and the history is empty", ((await storeOf(p, "watching")) ?? []).length === 0);
  await p.close();
}
{
  // Signed out: nothing is posted, whatever is cleared.
  const watching = [{ id: "tt0100003", title: "Fake Movie Three", kind: "movie", at: NOW - 7200_000, posSec: 1800, durSec: 6000 }];
  const p = await openPage({ connected: false, watching });
  await goTo(p, "mylist");
  await p.locator('.library__card[data-hint="Library"]').first().click({ timeout: 15_000 });
  const before = userData().length;
  await p.getByRole("button", { name: "Clear history", exact: true }).click();
  await p.getByRole("button", { name: "Click again to confirm" }).click();
  await waitFor(p, async () => ((await storeOf(p, "watching")) ?? []).length === 0, 8000);
  await p.waitForTimeout(1200);
  check(
    "signed out, clearing the history posts nothing to AIOStreams",
    userData().length === before && ((await storeOf(p, "watching")) ?? []).length === 0,
    JSON.stringify(userData().slice(before)),
  );
  await p.close();
}

// ------------------------------------------------------------ connecting
// Settings → General → Sources → Stream, from signed out: the address, the
// code, AIOStreams' configure page opened, approved on the second poll, then
// the account and a first sync. (These were the Accounts row's checks until
// plan 024 folded it into the sign-in.)
{
  const p = await openPage({ connected: false, canSource: true });
  await openAioTab(p);
  const before = calls.length;
  const connect = p.getByRole("button", { name: "Connect", exact: true });
  check("signed out, the tab offers an address field and Connect", (await p.getByPlaceholder("aiostreams.example.com", { exact: true }).count()) === 1 && (await connect.count()) === 1);
  await p.getByPlaceholder("aiostreams.example.com", { exact: true }).fill("aiostreams.example.com");
  await connect.click();
  const r = p.locator(".aio-row");
  const code = await r.locator(".trakt-row__code").innerText({ timeout: 5000 }).catch(() => "");
  check("Connect shows the 6-digit code, large", code === "123456", code);
  if (process.env.SHOT_DIR) await p.locator(".aio-row").first().screenshot({ path: `${process.env.SHOT_DIR}/aiojf-code.png` });
  const selectable = await r.locator(".trakt-row__code").evaluate((el) => getComputedStyle(el).userSelect);
  await r.getByRole("button", { name: "Copy code" }).click();
  const copied = await p.evaluate(() => [...window.__copied]);
  check("  the code can be selected, and its button copies it", selectable === "text" && copied.length === 1 && copied[0] === "123456", JSON.stringify({ selectable, copied }));
  check("  the note says where to approve it", /Save & Install, Jellyfin apps, Connect/.test(await r.innerText()), (await r.innerText()).replace(/\n/g, " | "));
  await r.getByRole("button", { name: "Open AIOStreams" }).click();
  const opened = await p.evaluate(() => window.__calls.filter(([c]) => c === "open_external").map(([, a]) => a.url));
  check(
    "  Open AIOStreams copies it again and opens the configure page through the app",
    opened[0] === MANIFEST_URL.replace("manifest.json", "configure") && (await p.evaluate(() => window.__copied.length)) === 2,
    JSON.stringify(opened),
  );
  const pending = (await connect.count()) === 0 && (await r.locator(".trakt-row__code").count()) === 1;
  check("  while it is pending the code stays up", pending);
  const on = await r.locator(".customize-row__title", { hasText: "Signed in as Adam" }).waitFor({ timeout: 12_000 }).then(() => true, () => false);
  const synced = await waitFor(p, async () => calls.slice(before).some((c) => c.path === "/UserItems/Resume"), 8000);
  await r.getByRole("button", { name: "Sync now" }).waitFor({ timeout: 8000 }).catch(() => {});
  const buttons = await r.getByRole("button").allInnerTexts();
  check("  approved on a later poll, it names the account, syncs, and offers Sync now and Disconnect", on && synced && buttons.includes("Sync now") && buttons.includes("Disconnect"), JSON.stringify({ on, synced, buttons }));
  check("  and it says when it last synced", /Synced (just now|a minute ago)/.test(await r.innerText()), (await r.innerText()).replace(/\n/g, " | "));
  check("  and says once about Trakt trackers", /Leave any Trakt tracker out of your AIOStreams setup, or each play counts twice\./.test(await r.innerText()));

  // Disconnect: two clicks, the token dropped natively, everything kept goes.
  await r.getByRole("button", { name: "Disconnect", exact: true }).click();
  await r.getByRole("button", { name: /Click again to confirm/ }).click();
  const gone = await connect.waitFor({ timeout: 5000 }).then(() => true, () => false);
  const wiped = { played: await storeOf(p, "aioWatched"), aiojf: await storeOf(p, "aiojf"), dis: await p.evaluate(() => window.__calls.filter(([c]) => c === "aiojf_disconnect").length) };
  check(
    "Disconnect signs the device out and clears what it kept",
    gone && wiped.dis === 1 && !wiped.played && Object.keys(wiped.aiojf ?? {}).length === 0,
    JSON.stringify({ gone, ...wiped }),
  );
  await p.close();
}
{
  const p = await openPage({ connected: false, poll: "expire", canSource: true });
  await openAioTab(p);
  await p.getByPlaceholder("aiostreams.example.com", { exact: true }).fill("aiostreams.example.com");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  await p.locator(".aio-row .trakt-row__code").waitFor({ timeout: 5000 });
  const gone = await p.getByText("The code ran out. Connect again for a new one.").waitFor({ timeout: 8000 }).then(() => true, () => false);
  check("an expired code says so and offers Connect again", gone && (await p.getByRole("button", { name: "Connect", exact: true }).count()) === 1);
  await p.close();
}
{
  const p = await openPage({ connected: false, start: "unsupported", canSource: true });
  await openAioTab(p);
  await p.getByPlaceholder("aiostreams.example.com", { exact: true }).fill("aiostreams.example.com");
  await p.getByRole("button", { name: "Connect", exact: true }).click();
  const said = await p.getByText("Your AIOStreams needs version 2.35 or later, with its Jellyfin side on.").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("an instance with no Jellyfin side says it needs version 2.35, Jellyfin side on", said);
  await p.close();
}
{
  const p = await openPage({ old: true });
  await openAioTab(p);
  const field = p.getByPlaceholder(/manifest\.json/);
  await field.waitFor({ timeout: 5000 });
  const text = await p.locator(".settings-section").first().innerText();
  check(
    "a native build from before the sync says it needs the app update, and offers no Connect",
    /Update the app/.test(text) && (await p.getByRole("button", { name: "Connect", exact: true }).count()) === 0 && (await p.locator(".aio-row").count()) === 0,
    text.replace(/\n/g, " | "),
  );
  await p.close();
}
{
  // Plan 023 hid the sync row until a manifest URL was stored, since its
  // token belonged to that config. The sign-in is its own connection now.
  const p = await openPage({ connected: false, url: false, canSource: true });
  await openAioTab(p);
  check(
    "with no AIOStreams URL the sign-in is still there: an address field and Connect",
    (await p.getByPlaceholder("aiostreams.example.com", { exact: true }).count()) === 1 &&
      (await p.getByRole("button", { name: "Connect", exact: true }).count()) === 1 &&
      (await p.getByPlaceholder(/manifest\.json/).count()) === 0 &&
      (await p.locator(".trakt-row").count()) === 1,
    `url ${JSON.stringify(await storeOf(p, "aiostreams"))}, ${await p.locator(".trakt-row").count()} trakt rows`,
  );
  await p.close();
}

// ------------------------------------------------------------ the URL
{
  // The stub here cannot open sources, so the manifest stays and its field
  // is offered next to the sign-in. Plan 023 signed out when the URL changed;
  // since plan 024 the sign-in is its own connection and the URL signs out
  // of nothing.
  const p = await openPage({ connected: true });
  await openAioTab(p);
  const r = p.locator(".aio-row");
  await r.getByRole("button", { name: "Disconnect", exact: true }).waitFor({ timeout: 8000 });
  const field = p.getByPlaceholder(/manifest\.json/);
  await field.fill(MANIFEST_URL + "?x=1");
  await p.getByRole("button", { name: "Submit" }).click();
  await waitFor(p, async () => (await storeOf(p, "aiostreams")) === MANIFEST_URL + "?x=1", 5000);
  await p.waitForTimeout(800);
  const dis = await p.evaluate(() => window.__calls.filter(([c]) => c === "aiojf_disconnect").length);
  check(
    "changing the AIOStreams URL leaves the sign-in alone",
    dis === 0 && (await r.getByRole("button", { name: "Disconnect", exact: true }).count()) === 1 && (await storeOf(p, "aiostreams")) === MANIFEST_URL + "?x=1",
    JSON.stringify({ dis, url: await storeOf(p, "aiostreams") }),
  );
  // And emptying it does the same.
  await field.fill("");
  await p.getByRole("button", { name: "Submit" }).click();
  await waitFor(p, async () => !(await storeOf(p, "aiostreams")), 5000);
  await p.waitForTimeout(800);
  check(
    "  and so does removing it",
    (await p.evaluate(() => window.__calls.filter(([c]) => c === "aiojf_disconnect").length)) === 0 && (await r.getByRole("button", { name: "Disconnect", exact: true }).count()) === 1,
  );
  await p.close();
}
{
  const p = await openPage({ connected: true });
  await openAioTab(p);
  const r = p.locator(".aio-row");
  await r.getByRole("button", { name: "Disconnect", exact: true }).waitFor({ timeout: 8000 });
  await p.getByRole("button", { name: "Clear…" }).click();
  await p.getByRole("button", { name: "Click again to confirm" }).click();
  const gone = await waitFor(p, async () => (await p.locator(".aio-row").count()) === 0, 5000);
  const dis = await p.evaluate(() => window.__calls.filter(([c]) => c === "aiojf_disconnect").length);
  check("Clear All Login Info signs out of the sync too, once, and the signed-in row goes", gone && dis === 1 && !(await storeOf(p, "aiostreams")), JSON.stringify({ gone, dis }));
  await p.close();
}

check("no page errors in Settings", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
