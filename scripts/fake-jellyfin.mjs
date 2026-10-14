// A fake Jellyfin 12.2 server for the harnesses (plan 027).
//
//   node scripts/fake-jellyfin.mjs        -> server on :8196
//
// Shapes are the real server's, captured by scripts/jf-probe.mjs on
// 2026-10-14 against Jellyfin 12.2.0 and kept in
// scripts/fixtures/jellyfin-12.2.json. What it copies on purpose, because
// code must not lean on the opposite:
//   - A token is read only from `Authorization: MediaBrowser ..., Token="..."`
//     or `?ApiKey=`. `?api_key=`, X-Emby-Token and X-MediaBrowser-Token are
//     401, as on 12.2. A 401 has an empty body.
//   - `/Videos/{id}/stream` and `/Items/{id}/Images/*` answer with no token
//     at all (the spec lists no security on the stream; images likewise).
//   - A wrong password is 401 text/plain "Error processing request.".
//   - `Recursive=true` with no IncludeItemTypes returns Folder items too:
//     the "Movies" library holds three, as the real one did.
//   - PlaybackInfo's Path is the server's own file path, not a URL.
//   - Stop reports (round 2, a 600s item, server defaults MinResumePct 5,
//     MaxResumePct 90, MinResumeDurationSeconds 300): under 5% the position
//     resets and the item is not played; 5 to 90% saves the position (it
//     joins Resume); over 90% marks it played at position 0. An item under
//     300s is played at any stop over 5% and never resumable. Every stop
//     adds a play. The exact 90% edge was not hit by the probe (85, 95).
//   - An unknown item id is 404 problem+json, a non-GUID id is 400
//     problem+json, a report on an unknown item is 204, an unknown route is
//     an empty 404, an unknown Quick Connect secret is 404 "Unknown secret".
//   - The external subtitle route answers with no token (200 for a stream
//     that exists, 500 for one that does not). A subtitle's DeliveryUrl
//     carries the session token in the real answer, which is why jf.rs drops
//     it; here it carries a placeholder.
// Not captured, so built from the shapes around it: the movie's
// PlaybackInfo (the real movie in Adam's library is a game-mod file, so it
// is derived from an episode); Quick Connect Authorize (from the spec).
//
// Hooks for harnesses: GET /__log, DELETE /__log, GET /__state, POST /__reset,
// POST /__approve?code=, POST /__segments/{id} (body: array of segments),
// POST /__setpass?pw=.
import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.FAKE_JELLYFIN_PORT || 8196);
const FIX = JSON.parse(
  readFileSync(new URL("./fixtures/jellyfin-12.2.json", import.meta.url), "utf8"),
);
const USER = FIX.user.Name;
let PASSWORD = "pw";
const TICKS = 10_000_000;
const MIN_RESUME_PCT = 5;
const MAX_RESUME_PCT = 90;
const MIN_RESUME_DURATION_S = 300; // server defaults; see the header

const hex = (n) => randomBytes(n).toString("hex");
let tokens, qc, ud, segments, log;
function reset() {
  tokens = new Set();
  qc = new Map(); // secret -> { code, approved, result }
  ud = new Map(); // item id -> user data fields
  segments = new Map();
  log = [];
}
reset();

// ---- the library's shape ----
const items = FIX.items;
const movieId = FIX.movieId;
const kids = {
  [FIX.views[0].Id]: [movieId, ...FIX.junk.map((j) => j.Id)],
  [FIX.views[1].Id]: [...FIX.seriesIds],
};
for (const j of FIX.junk) items[j.Id] = j;
const seasonsOf = (sid) => Object.values(items).filter((i) => i.Type === "Season" && i.SeriesId === sid);
const episodesOf = (sid) =>
  Object.values(items)
    .filter((i) => i.Type === "Episode" && i.SeriesId === sid)
    .sort((a, b) => a.ParentIndexNumber - b.ParentIndexNumber || a.IndexNumber - b.IndexNumber);
const childrenOf = (id) =>
  kids[id]
    ? kids[id].map((x) => items[x])
    : items[id]?.Type === "Series"
      ? seasonsOf(id)
      : items[id]?.Type === "Season"
        ? Object.values(items).filter((i) => i.Type === "Episode" && i.SeasonId === id)
        : [];
const descendants = (id) => childrenOf(id).flatMap((c) => [c, ...descendants(c.Id)]);
const sourceOf = (id) => FIX.playbackInfo[id]?.MediaSources?.[0];
const runtimeOf = (id) => items[id]?.RunTimeTicks || sourceOf(id)?.RunTimeTicks || 0;

// ---- watch state ----
const state = (id) => ud.get(id) || { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false };
function withUserData(it) {
  const s = state(it.Id);
  const base = it.UserData || {};
  return { ...it, UserData: { ...s, Key: base.Key, ItemId: it.Id } };
}
function stop(id, pos) {
  const s = { ...state(id) };
  const dur = runtimeOf(id);
  const pct = dur ? (pos / dur) * 100 : 0;
  s.PlayCount += 1;
  s.LastPlayedDate = new Date().toISOString();
  if (pct < MIN_RESUME_PCT) {
    s.PlaybackPositionTicks = 0; // observed at 3%
    delete s.PlayedPercentage;
  } else if (dur < MIN_RESUME_DURATION_S * TICKS || pct >= MAX_RESUME_PCT) {
    s.Played = true; // observed: 30s clips at any stop over 5%, 600s at 95 and 100
    delete s.PlayedPercentage;
    s.PlaybackPositionTicks = 0;
  } else {
    s.PlaybackPositionTicks = pos; // observed at 50% and 85% of a 600s item
    s.PlayedPercentage = Math.round(pct);
  }
  ud.set(id, s);
}

// ---- http ----
const GUID = /^[0-9a-f]{32}$|^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const problem = (res, status, title, extra = {}) => {
  res.writeHead(status, { "content-type": "application/problem+json; charset=utf-8" });
  res.end(JSON.stringify({ type: `https://tools.ietf.org/html/rfc9110#section-15.5.${status === 400 ? 1 : 5}`, title, status, traceId: "00-" + hex(16) + "-" + hex(8) + "-00", ...extra }));
  return true;
};
/** An item id the way the real server reads it: not a GUID is a 400, a GUID it
 * does not hold a 404, both problem+json. Null when the id is fine. */
const badId = (res, id) =>
  !GUID.test(id)
    ? problem(res, 400, "One or more validation errors occurred.", { errors: { itemId: [`The value '${id}' is not valid.`] } })
    : null;
const norm = (id) => id.replace(/-/g, "").toLowerCase();
const send = (res, status, body, type = "application/json; charset=utf-8", extra = {}) => {
  if (body === undefined || body === "") {
    res.writeHead(status, { "content-length": "0", ...extra });
    return res.end();
  }
  const b = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, ...extra });
  res.end(b);
};
const unauth = (res) => send(res, 401, "");
const list = (arr, start = 0) => ({ Items: arr, TotalRecordCount: arr.length, StartIndex: start });

function tokenOf(req, url) {
  const m = /^MediaBrowser\s+(.*)$/i.exec(req.headers.authorization || "");
  if (m) {
    const t = /Token="([^"]*)"/.exec(m[1]);
    if (t && tokens.has(t[1])) return t[1];
  }
  const k = qget(url, "ApiKey");
  return k && tokens.has(k) ? k : null;
}
function authResult() {
  const t = hex(16);
  tokens.add(t);
  return {
    User: FIX.user,
    SessionInfo: { ...FIX.session, Id: hex(16) },
    AccessToken: t,
    ServerId: FIX.serverId,
  };
}
// ASP.NET binds query names case-insensitively (the probe sent ParentId,
// Recursive, Fields and userId and every one took).
const qget = (url, k) => {
  for (const [n, v] of url.searchParams) if (n.toLowerCase() === k.toLowerCase()) return v;
  return null;
};
const csv = (v) => (v ? v.split(",").map((x) => x.trim().toLowerCase()) : null);
function itemsQuery(url) {
  const q = { get: (k) => qget(url, k) };
  const pid = q.get("parentId");
  let pool = pid
    ? q.get("recursive") === "true"
      ? descendants(pid)
      : childrenOf(pid)
    : q.get("recursive") === "true"
      ? Object.values(items)
      : FIX.views;
  const types = csv(q.get("includeItemTypes"));
  if (types) pool = pool.filter((i) => types.includes(i.Type.toLowerCase()));
  const ids = csv(q.get("ids"));
  if (ids) pool = Object.values(items).filter((i) => ids.includes(i.Id));
  if (q.get("isPlayed") === "true") pool = pool.filter((i) => state(i.Id).Played);
  if (q.get("isPlayed") === "false") pool = pool.filter((i) => !state(i.Id).Played);
  const total = pool.length;
  const start = Number(q.get("startIndex") || 0);
  const lim = q.get("limit") ? Number(q.get("limit")) : pool.length;
  return { ...list(pool.slice(start, start + lim).map(withUserData), start), TotalRecordCount: total };
}
function nextUp(url) {
  const only = qget(url, "seriesId");
  const out = [];
  for (const sid of FIX.seriesIds) {
    if (only && only !== sid) continue;
    const eps = episodesOf(sid);
    let last = -1;
    eps.forEach((e, i) => state(e.Id).Played && (last = i));
    if (last >= 0 && eps[last + 1] && !state(eps[last + 1].Id).Played) out.push(eps[last + 1]);
  }
  return list(out.map(withUserData));
}
const body = (req) =>
  new Promise((ok) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch {
        ok(null);
      }
    });
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    const seg = p.split("/").filter(Boolean);
    const m = req.method;
    if (p.startsWith("/__")) {
      if (p === "/__log") {
        if (m === "DELETE") log = [];
        return send(res, 200, log);
      }
      if (p === "/__reset") return reset(), send(res, 200, { ok: true });
      if (p === "/__state") return send(res, 200, { ud: Object.fromEntries(ud), tokens: tokens.size });
      if (p === "/__setpass") return (PASSWORD = url.searchParams.get("pw") || "pw"), send(res, 200, {});
      if (p === "/__approve") {
        for (const v of qc.values()) if (v.code === qget(url, "code")) v.approved = true;
        return send(res, 200, { ok: true });
      }
      if (seg[1] === "__segments") return segments.set(seg[2], await body(req)), send(res, 200, {});
      return send(res, 404, "");
    }
    const entry = { method: m, path: p, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ? "header" : "" };
    log.push(entry);
    const j = m === "POST" || m === "PUT" ? await body(req) : {};
    if (j === null) return send(res, 400, "");

    // open routes
    if (p === "/System/Info/Public") return send(res, 200, FIX.info);
    if (p === "/Users/AuthenticateByName") {
      return j.Username === USER && j.Pw === PASSWORD
        ? send(res, 200, authResult())
        : send(res, 401, "Error processing request.", "text/plain");
    }
    if (p === "/QuickConnect/Enabled") return send(res, 200, "true");
    if (p === "/QuickConnect/Initiate" && m === "POST") {
      const secret = hex(32);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      qc.set(secret, { code, approved: false });
      return send(res, 200, {
        Authenticated: false,
        Secret: secret,
        Code: code,
        DeviceId: "blammytv",
        DeviceName: "PC",
        AppName: "BlammyTV",
        AppVersion: "0.0.0",
        DateAdded: new Date().toISOString(),
      });
    }
    if (p === "/QuickConnect/Connect") {
      const s = qget(url, "secret") && qc.get(qget(url, "secret"));
      return s
        ? send(res, 200, { Authenticated: s.approved, Secret: qget(url, "secret"), Code: s.code, DeviceId: "blammytv", DeviceName: "PC", AppName: "BlammyTV", AppVersion: "0.0.0", DateAdded: new Date().toISOString() })
        : send(res, 404, '"Unknown secret"');
    }
    if (p === "/Users/AuthenticateWithQuickConnect") {
      const s = qc.get(j.Secret);
      return s?.approved ? send(res, 200, authResult()) : send(res, 400, "");
    }
    if (seg[0] === "Videos" && seg[2] === "stream") {
      const src = sourceOf(seg[1]);
      if (!src) return send(res, 404, "");
      const size = src.Size || 558231;
      const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      const a = rg && rg[1] !== "" ? Number(rg[1]) : 0;
      const b = rg && rg[2] !== "" ? Math.min(Number(rg[2]), size - 1) : size - 1;
      return send(res, rg ? 206 : 200, Buffer.alloc(b - a + 1, 0x1a), "video/x-matroska", {
        "accept-ranges": "bytes",
        ...(rg ? { "content-range": `bytes ${a}-${b}/${size}` } : {}),
      });
    }
    if (seg[0] === "Videos" && seg[3] === "Subtitles" && /^Stream\.\w+$/.test(seg[seg.length - 1])) {
      const id = norm(seg[1]);
      const ext = seg[seg.length - 1].split(".")[1];
      const stream = sourceOf(id)?.MediaStreams?.find((x) => x.Type === "Subtitle" && String(x.Index) === seg[4]);
      // observed: a stream that does not exist is a 500, token or none
      return stream
        ? send(res, 200, "1\n00:00:01,000 --> 00:00:03,000\nhello\n\n2\n00:00:05,000 --> 00:00:07,000\nworld\n\n", ext === "srt" ? "application/x-subrip" : "text/plain")
        : send(res, 500, "");
    }
    if (seg[0] === "Items" && seg[2] === "Images") {
      return items[seg[1]] || FIX.views.some((v) => v.Id === seg[1])
        ? send(res, 200, Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"), "image/jpeg")
        : send(res, 404, "");
    }

    // everything else needs the token
    const tok = tokenOf(req, url);
    if (!tok) return unauth(res);
    entry.auth = "token";

    if (p === "/Sessions/Logout") return tokens.delete(tok), send(res, 204, "");
    if (p === "/QuickConnect/Authorize") {
      for (const v of qc.values()) if (v.code === qget(url, "code")) v.approved = true;
      return send(res, 200, "true");
    }
    if (p === "/UserViews") return send(res, 200, list(FIX.views.map(withUserData)));
    if (p === "/Items" && m === "GET") return send(res, 200, itemsQuery(url));
    if (p === "/Items/Filters") return send(res, 200, { Genres: [], Tags: [], OfficialRatings: [], Years: [] });
    if (seg[0] === "Items" && seg.length === 2 && m === "GET") {
      if (badId(res, seg[1])) return;
      const it = items[norm(seg[1])] || FIX.views.find((v) => v.Id === norm(seg[1])) || (/^0+$/.test(norm(seg[1])) ? { Name: "Media Folders", Id: "e9d5075a555c1cbc394eec4cef295274", Type: "AggregateFolder" } : null);
      if (!it) return problem(res, 404, "Not Found");
      return send(res, 200, withUserData(it));
    }
    if (seg[0] === "Items" && seg[2] === "PlaybackInfo") {
      const pi = FIX.playbackInfo[seg[1]];
      if (pi) return send(res, 200, { ...pi, PlaySessionId: hex(16) });
      const donor = FIX.playbackInfo[FIX.episodeIds[0]].MediaSources[0];
      if (badId(res, seg[1])) return;
      if (seg[1] !== movieId) return problem(res, 404, "Not Found");
      const ms = { ...donor, Id: movieId, Name: items[movieId].Name, Container: "mkv", Path: `C:\\jf-test\\movies\\${items[movieId].Name}.mkv` };
      return send(res, 200, { MediaSources: [ms], PlaySessionId: hex(16) });
    }
    if (seg[0] === "Shows" && seg[2] === "Seasons") return send(res, 200, list(seasonsOf(seg[1]).map(withUserData)));
    if (seg[0] === "Shows" && seg[2] === "Episodes") {
      const sid = qget(url, "seasonId");
      const eps = episodesOf(seg[1]).filter((e) => !sid || e.SeasonId === sid);
      return send(res, 200, list(eps.map(withUserData)));
    }
    if (p === "/Shows/NextUp") return send(res, 200, nextUp(url));
    if (p === "/Shows/Upcoming") return send(res, 200, list([]));
    if (p === "/UserItems/Resume") {
      const out = Object.values(items).filter((i) => state(i.Id).PlaybackPositionTicks > 0 && !state(i.Id).Played);
      return send(res, 200, list(out.map(withUserData)));
    }
    if (seg[0] === "UserItems" && seg[2] === "UserData") {
      if (badId(res, seg[1])) return;
      if (!items[seg[1]]) return problem(res, 404, "Not Found");
      if (m === "POST") ud.set(seg[1], { ...state(seg[1]), ...j });
      return send(res, 200, withUserData(items[seg[1]]).UserData);
    }
    if (seg[0] === "UserPlayedItems" && seg.length === 2) {
      if (badId(res, seg[1])) return;
      if (!items[seg[1]]) return problem(res, 404, "Not Found");
      const s = { ...state(seg[1]) };
      if (m === "POST") {
        s.Played = true;
        s.PlayCount = Math.max(1, s.PlayCount);
        s.PlaybackPositionTicks = 0;
        s.LastPlayedDate = new Date().toISOString();
      } else {
        s.Played = false;
        s.PlayCount = 0;
        s.PlaybackPositionTicks = 0;
        delete s.LastPlayedDate;
      }
      ud.set(seg[1], s);
      return send(res, 200, withUserData(items[seg[1]]).UserData);
    }
    if (p === "/Sessions/Playing" || p === "/Sessions/Playing/Progress") return entry.body = j, send(res, 204, "");
    if (p === "/Sessions/Playing/Stopped") {
      entry.body = j;
      if (items[j.ItemId]) stop(j.ItemId, Number(j.PositionTicks || 0));
      return send(res, 204, "");
    }
    if (seg[0] === "MediaSegments") return send(res, 200, list(segments.get(seg[1]) || []));
    return send(res, 404, "");
  })
  .listen(PORT, () => console.log(`fake jellyfin on :${PORT}`));
