import { httpGetJson } from "../lib/http";
import type { StalkerPlaylist } from "../features/settings/playlists";

/**
 * Stalker / Ministra ("MAG portal") middleware client. Identity is a MAC
 * address, not a username/password: a handshake yields a bearer token, every
 * later call carries `Authorization: Bearer` + a `Cookie` (mac/lang/timezone)
 * + a MAG-STB `User-Agent`, and — unlike Xtream — a channel row holds an
 * opaque `cmd` that must be exchanged per-play (`create_link`) for a
 * short-lived tokenized stream URL. Protocol reference with sources:
 * docs/stalker-implementation.md. All fetches ride `lib/http` with explicit
 * headers (Rust-side in the app: portals send no CORS headers, and the
 * Cookie/Authorization/UA must reach the wire — browsers drop them).
 *
 * NEVER log the Cookie (carries the MAC), the token, or a resolved stream
 * URL (carries a play_token) — this module logs nothing.
 */

export interface StalkerGenre {
  id: string;
  title: string;
  censored: boolean;
}

export interface StalkerChannel {
  id: string;
  name: string;
  /** Provider channel number, when sane. */
  number?: number;
  /** The opaque play command — feed to createLink at play time. */
  cmd: string;
  /** EPG join key (unused for now: EPG arrives keyed by channel id). */
  xmltvId?: string;
  logo?: string;
  genreId?: string;
  /** Per-channel adult flag (`censored`). */
  censored: boolean;
}

/** One programme, UNIX-second timestamps straight off the portal. */
export interface StalkerProgramme {
  title: string;
  synopsis?: string;
  start: number;
  stop: number;
}

/** A live session against one portal: the endpoint that answered the
 * handshake plus its bearer token. Held in-memory per playlist; tokens
 * expire (~1h on some portals), so callers go through withSession, which
 * re-handshakes once on failure. */
interface Session {
  base: string;
  token: string;
}
const sessions = new Map<string, Session>();

/** Drop a playlist's cached session (tests, or a Settings credential edit). */
export function resetStalkerSession(playlistId: string): void {
  sessions.delete(playlistId);
}

// The MAG-STB identity headers. Some portals reject a browser UA outright,
// so every call presents as a MAG254 box (the string real clients send).
const MAG_UA =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
// Firmware descriptor get_profile expects; content is boilerplate.
const PROFILE_VER =
  "ImageDescription: 0.2.18-r14-pub-250; ImageDate: Fri Jan 15 15:20:44 EET 2016; PORTAL version: 5.6.0; API Version: JS API version: 328; STB API version: 134; Player Engine version: 0x566";

function stalkerHeaders(
  p: StalkerPlaylist,
  base: string,
  token?: string,
): Record<string, string> {
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  const headers: Record<string, string> = {
    "User-Agent": MAG_UA,
    "X-User-Agent": "Model: MAG254; Link: WiFi",
    Accept: "*/*",
    Referer: new URL(base).origin + "/c/",
    Cookie: `mac=${encodeURIComponent(p.mac.trim())}; stb_lang=en; timezone=${encodeURIComponent(tz)}`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Pure URL builder: one endpoint, action params, the JsHttpRequest
 * transport marker (the response is JSON despite the "xml" token). */
export function actionUrl(
  base: string,
  params: Record<string, string>,
): string {
  const qs = new URLSearchParams({ ...params, JsHttpRequest: "1-xml" });
  return `${base}?${qs}`;
}

/** Every response is `{ "js": <payload> }`; auth failures commonly arrive as
 * HTTP 200 with `{"js":{"error":"..."}}`. Unwrap or throw. */
function unwrapJs<T>(res: unknown, what: string): T {
  const js = (res as { js?: unknown } | null)?.js;
  if (js == null) throw new Error(`the portal returned no data for ${what}`);
  if (
    typeof js === "object" &&
    !Array.isArray(js) &&
    typeof (js as { error?: unknown }).error === "string"
  ) {
    throw new Error(String((js as { error: string }).error));
  }
  return js as T;
}

/** The endpoint path varies by install (`load.php`, `portal.php`, …) with no
 * universal rule — real clients probe. Candidates: a remembered/explicit
 * .php path first, then the common layouts. */
function candidateBases(p: StalkerPlaylist): string[] {
  const portal = p.portal.trim().replace(/\/+$/, "");
  if (/\.php$/i.test(portal)) return [portal];
  const bases = [
    `${portal}/stalker_portal/server/load.php`,
    `${portal}/portal.php`,
    `${portal}/c/portal.php`,
    `${portal}/stalker_portal/c/portal.php`,
  ];
  return p.endpoint ? [p.endpoint, ...bases.filter((b) => b !== p.endpoint)] : bases;
}

/** Step 1: handshake (no Authorization) → bearer token. */
async function handshake(p: StalkerPlaylist, base: string): Promise<string> {
  const res = await httpGetJson<unknown>(
    actionUrl(base, { type: "stb", action: "handshake", token: "" }),
    stalkerHeaders(p, base),
  );
  const js = unwrapJs<{ token?: string }>(res, "the handshake");
  if (!js.token) throw new Error("the portal did not return a session token");
  return js.token;
}

/** Step 2: get_profile registers the device; a blocked/expired account is
 * surfaced here rather than as empty channel lists later. */
async function getProfile(p: StalkerPlaylist, s: Session): Promise<void> {
  const res = await httpGetJson<unknown>(
    actionUrl(s.base, {
      type: "stb",
      action: "get_profile",
      hd: "1",
      ver: PROFILE_VER,
      num_banks: "1",
      stb_type: "MAG254",
      image_version: "218",
      auth_second_step: "0",
      hw_version: "1.7-BD-00",
      not_valid_token: "0",
    }),
    stalkerHeaders(p, s.base, s.token),
  );
  const js = unwrapJs<{ blocked?: string | number }>(res, "the profile");
  if (String(js.blocked ?? "0") === "1") {
    throw new Error("the portal reports this device as blocked");
  }
}

/** Probe candidate endpoints until one handshakes, register the device, and
 * cache the session. Throws the LAST failure when nothing answers. */
async function openSession(p: StalkerPlaylist): Promise<Session> {
  let lastErr: unknown = new Error("no portal endpoint answered");
  for (const base of candidateBases(p)) {
    try {
      const token = await handshake(p, base);
      const s: Session = { base, token };
      await getProfile(p, s);
      sessions.set(p.id, s);
      return s;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Run an authenticated call; on ANY failure, re-handshake once and retry —
 * the lazy-refresh strategy. Tokens expire (~1h) and the failure mode that
 * actually bites is create_link after an idle stretch, which this covers
 * without a watchdog heartbeat. */
async function withSession<T>(
  p: StalkerPlaylist,
  fn: (s: Session) => Promise<T>,
): Promise<T> {
  const cached = sessions.get(p.id);
  if (cached) {
    try {
      return await fn(cached);
    } catch {
      sessions.delete(p.id);
    }
  }
  const fresh = await openSession(p);
  return fn(fresh);
}

/** The portal's session endpoint, once discovered (for the add-form to
 * persist onto the playlist so later loads skip the probe). */
export async function discoverEndpoint(p: StalkerPlaylist): Promise<string> {
  const s = sessions.get(p.id) ?? (await openSession(p));
  return s.base;
}

export async function fetchGenres(
  p: StalkerPlaylist,
): Promise<StalkerGenre[]> {
  return withSession(p, async (s) => {
    const res = await httpGetJson<unknown>(
      actionUrl(s.base, { type: "itv", action: "get_genres" }),
      stalkerHeaders(p, s.base, s.token),
    );
    const js = unwrapJs<Array<{ id?: unknown; title?: unknown; censored?: unknown }>>(
      res,
      "the categories",
    );
    if (!Array.isArray(js)) return [];
    return js
      .filter((g) => g.id != null)
      .map((g) => ({
        id: String(g.id),
        title: String(g.title ?? g.id),
        censored: Number(g.censored) === 1,
      }))
      // "*" (and "0" on some portals) is the "All" pseudo-genre, not a
      // real category — a folder for it would duplicate every channel.
      .filter((g) => g.id !== "*" && g.id !== "0");
  });
}

/** Raw channel row, permissive like the Xtream shapes — portals string-type
 * numbers and omit fields freely. */
interface RawChannel {
  id?: unknown;
  name?: unknown;
  number?: unknown;
  cmd?: unknown;
  xmltv_id?: unknown;
  logo?: unknown;
  tv_genre_id?: unknown;
  censored?: unknown;
}

function mapChannel(base: string, r: RawChannel): StalkerChannel | null {
  if (r.id == null || typeof r.cmd !== "string" || !r.cmd) return null;
  const num = Math.floor(Number(r.number));
  const logoRaw = typeof r.logo === "string" ? r.logo.trim() : "";
  // Logos are frequently portal-relative paths (misc/logos/x.png).
  let logo: string | undefined;
  if (/^https?:\/\//i.test(logoRaw)) logo = logoRaw;
  else if (logoRaw) logo = `${new URL(base).origin}/${logoRaw.replace(/^\/+/, "")}`;
  return {
    id: String(r.id),
    name: String(r.name ?? r.id),
    ...(Number.isFinite(num) && num > 0 ? { number: num } : {}),
    cmd: r.cmd,
    ...(r.xmltv_id ? { xmltvId: String(r.xmltv_id) } : {}),
    ...(logo ? { logo } : {}),
    ...(r.tv_genre_id != null ? { genreId: String(r.tv_genre_id) } : {}),
    censored: Number(r.censored) === 1,
  };
}

/** All channels: the bulk call first (one request, verified unpaginated in
 * the reference server), falling back to the per-genre paginated walk that
 * portals without get_all_channels require. */
export async function fetchChannels(
  p: StalkerPlaylist,
  genreIds: string[],
): Promise<StalkerChannel[]> {
  return withSession(p, async (s) => {
    const bulk = await httpGetJson<unknown>(
      actionUrl(s.base, { type: "itv", action: "get_all_channels" }),
      stalkerHeaders(p, s.base, s.token),
    );
    const bulkJs = unwrapJs<{ data?: RawChannel[] }>(bulk, "the channel list");
    const bulkRows = Array.isArray(bulkJs.data) ? bulkJs.data : [];
    if (bulkRows.length) {
      return bulkRows
        .map((r) => mapChannel(s.base, r))
        .filter((c): c is StalkerChannel => c !== null);
    }

    // Fallback: page through each genre (1-based pages; page size comes
    // from the first response). Pages are capped defensively — a portal
    // that lies about total_items must not loop us forever.
    const out: StalkerChannel[] = [];
    const seen = new Set<string>();
    for (const genre of genreIds) {
      let page = 1;
      let pages = 1;
      const MAX_PAGES = 200;
      while (page <= pages && page <= MAX_PAGES) {
        const res = await httpGetJson<unknown>(
          actionUrl(s.base, {
            type: "itv",
            action: "get_ordered_list",
            genre,
            p: String(page),
            fav: "0",
            sortby: "number",
            hd: "0",
            force_ch_link_check: "",
          }),
          stalkerHeaders(p, s.base, s.token),
        );
        const js = unwrapJs<{
          total_items?: unknown;
          max_page_items?: unknown;
          data?: RawChannel[];
        }>(res, "the channel list");
        const rows = Array.isArray(js.data) ? js.data : [];
        if (page === 1) {
          const total = Number(js.total_items) || rows.length;
          const per = Number(js.max_page_items) || rows.length || 1;
          pages = Math.max(1, Math.ceil(total / per));
        }
        for (const r of rows) {
          const c = mapChannel(s.base, r);
          if (c && !seen.has(c.id)) {
            seen.add(c.id);
            out.push(c);
          }
        }
        if (!rows.length) break; // a lying portal ran dry — stop early
        page += 1;
      }
    }
    return out;
  });
}

/** Raw programme row (get_epg_info values / get_short_epg entries). */
interface RawProgramme {
  name?: unknown;
  descr?: unknown;
  start_timestamp?: unknown;
  stop_timestamp?: unknown;
}

function mapProgrammes(rows: RawProgramme[] | undefined): StalkerProgramme[] {
  if (!Array.isArray(rows)) return [];
  const out: StalkerProgramme[] = [];
  for (const r of rows) {
    const start = Number(r.start_timestamp);
    const stop = Number(r.stop_timestamp);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start)
      continue;
    out.push({
      title: String(r.name ?? "Programme"),
      ...(r.descr ? { synopsis: String(r.descr) } : {}),
      start,
      stop,
    });
  }
  return out;
}

/** Bulk EPG: `get_epg_info` returns a map keyed by channel id — compact
 * JSON, no XMLTV document (the 95MB-DOMParser saga has no Stalker analogue).
 * `period`'s unit is portal-version-dependent (hours vs days), so callers
 * clamp to the guide window themselves; an empty result is best-effort fine
 * (channels render "No Information"). */
export async function fetchEpg(
  p: StalkerPlaylist,
  period = 12,
): Promise<Map<string, StalkerProgramme[]>> {
  return withSession(p, async (s) => {
    const res = await httpGetJson<unknown>(
      actionUrl(s.base, {
        type: "itv",
        action: "get_epg_info",
        period: String(period),
      }),
      stalkerHeaders(p, s.base, s.token),
    );
    const js = unwrapJs<Record<string, RawProgramme[]>>(res, "the guide");
    const out = new Map<string, StalkerProgramme[]>();
    if (js && typeof js === "object" && !Array.isArray(js)) {
      for (const [chId, rows] of Object.entries(js)) {
        const mapped = mapProgrammes(rows);
        if (mapped.length) out.set(String(chId), mapped);
      }
    }
    return out;
  });
}

/** Per-channel short EPG (now + next few) — the lazy fallback when a portal
 * ignores get_epg_info. */
export async function fetchShortEpg(
  p: StalkerPlaylist,
  channelId: string,
  size = 10,
): Promise<StalkerProgramme[]> {
  return withSession(p, async (s) => {
    const res = await httpGetJson<unknown>(
      actionUrl(s.base, {
        type: "itv",
        action: "get_short_epg",
        ch_id: channelId,
        size: String(size),
      }),
      stalkerHeaders(p, s.base, s.token),
    );
    return mapProgrammes(unwrapJs<RawProgramme[]>(res, "the guide"));
  });
}

/** Exchange a channel's opaque `cmd` for a playable URL — a live round-trip
 * on EVERY play: the returned URL carries a short-lived play_token and must
 * never be cached or persisted. The response cmd may be prefixed with a
 * "solution" word (`ffmpeg`, `ffrt`, `auto`, …) — the stream is the first
 * http(s) token. */
export async function createLink(
  p: StalkerPlaylist,
  cmd: string,
): Promise<string> {
  return withSession(p, async (s) => {
    const res = await httpGetJson<unknown>(
      actionUrl(s.base, {
        type: "itv",
        action: "create_link",
        cmd,
        forced_storage: "undefined",
        disable_ad: "0",
      }),
      stalkerHeaders(p, s.base, s.token),
    );
    const js = unwrapJs<{ cmd?: unknown }>(res, "the stream link");
    const raw = typeof js.cmd === "string" ? js.cmd : "";
    const m = raw.match(/https?:\/\/\S+/i);
    if (!m) throw new Error("the portal returned no playable stream link");
    return m[0];
  });
}
