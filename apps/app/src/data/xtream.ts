import { httpGetBytes, httpGetJson } from "../lib/http";
import { agentHeaders, cleanUserAgent } from "../lib/userAgent";
import type { XtreamPlaylist } from "../features/settings/playlists";

/**
 * Xtream Codes panel endpoints (`player_api.php` + `xmltv.php`). Panels are
 * loosely typed — numbers arrive as strings and fields go missing — so the
 * raw shapes are permissive and callers normalize. All fetches ride
 * `lib/http` (Rust-side in the app: panels send no CORS headers).
 *
 * A playlist's own User-Agent (Settings → Sources → Advanced) rides every call
 * here as a header. Without one the call is the one it always was.
 */

/** The headers a request for this playlist adds: its User-Agent, or none. */
const asked = (p: XtreamPlaylist) => agentHeaders(cleanUserAgent(p.userAgent));

export interface XtreamCategory {
  id: string;
  name: string;
  /** Panel `is_adult` flag, coerced (sent as "0"/"1" or 0/1, when at all).
   * Policy (hide/show, name fallback) lives in features/live/adult.ts. */
  adult: boolean;
}

/** Raw live stream entry, straight off the panel. */
export interface XtreamStream {
  stream_id: number | string;
  name?: string;
  stream_icon?: string | null;
  epg_channel_id?: string | null;
  category_id?: string | number | null;
  /** Provider channel number (LCN). String-typed as often as numeric. */
  num?: number | string | null;
  /** Server catch-up flag. Panels send 0/1, and as often a *string* ("1"),
   * so callers coerce. */
  tv_archive?: number | string | null;
  /** Archive depth in days — likewise string-typed off the panel ("3"). */
  tv_archive_duration?: number | string | null;
  /** Some panels flag adult content per stream ("0"/"1", or numeric). */
  is_adult?: number | string | null;
}

interface XtreamAuth {
  user_info?: {
    auth?: number;
    status?: string;
    message?: string;
    /** Connection usage — string-typed off most panels ("2", "5"). */
    active_cons?: number | string | null;
    max_connections?: number | string | null;
  };
}

export interface XtreamConnections {
  active: number;
  max: number;
}

/** Coerce the panel's connection counters. Null when the panel doesn't
 * report a usable limit (absent fields, junk values, max of 0 — some
 * panels send "0" while happily serving streams) — the UI hides the
 * pill rather than showing a wrong number. */
export function parseConnections(
  info: XtreamAuth["user_info"],
): XtreamConnections | null {
  if (info?.active_cons == null || info?.max_connections == null) return null;
  const active = Number(info.active_cons);
  const max = Number(info.max_connections);
  if (!Number.isFinite(active) || !Number.isFinite(max)) return null;
  if (max <= 0 || active < 0) return null;
  return { active, max };
}

/** Light account poll for the sidebar's connection pill — the same tiny
 * player_api endpoint authenticate uses. Null when the panel reports no
 * usable limit; THROWS when the poll itself fails, so a caller can keep
 * the last reading rather than take a slow panel for one with no limit
 * (plan 018, L1: that let multi-view past the line's cap for a minute). */
export async function fetchConnections(
  p: XtreamPlaylist,
): Promise<XtreamConnections | null> {
  const auth = await httpGetJson<XtreamAuth>(playerApiUrl(p), asked(p));
  return parseConnections(auth?.user_info);
}

/** Pure URL builders, separated from the fetches for testability. */
function playerApiUrl(
  p: XtreamPlaylist,
  params: Record<string, string> = {},
): string {
  const base = p.server.trim().replace(/\/+$/, "");
  const qs = new URLSearchParams({
    username: p.username,
    password: p.password,
    ...params,
  });
  return `${base}/player_api.php?${qs}`;
}

export function liveCategoriesUrl(p: XtreamPlaylist): string {
  return playerApiUrl(p, { action: "get_live_categories" });
}

function liveStreamsUrl(p: XtreamPlaylist): string {
  return playerApiUrl(p, { action: "get_live_streams" });
}

function xmltvUrl(p: XtreamPlaylist): string {
  const base = p.server.trim().replace(/\/+$/, "");
  const qs = new URLSearchParams({
    username: p.username,
    password: p.password,
  });
  return `${base}/xmltv.php?${qs}`;
}

/** What a panel that refuses an account says: its own message or status, else
 * this. */
const refusal = (info: XtreamAuth["user_info"]): string =>
  info?.message ?? info?.status ?? "the panel rejected the credentials";

/** Verify the account; throws if the panel rejects the credentials. */
export async function authenticate(p: XtreamPlaylist): Promise<void> {
  const auth = await httpGetJson<XtreamAuth>(playerApiUrl(p), asked(p));
  if (auth?.user_info?.auth !== 1) throw new Error(refusal(auth?.user_info));
}

/**
 * The error for a list call the panel answered with something that is not a
 * list. A panel whose account lapsed answers EVERY call with its sign-in
 * object (`{"user_info":{"auth":0}}`) and a 200, which reads as an empty list
 * unless it is refused: callers keep what they had on an error and not on an
 * empty answer.
 */
function notAList(raw: unknown): Error {
  throwIfRefused(raw);
  return new Error("the panel didn’t return a list");
}

/** Throw the panel's refusal when `raw` is a sign-in object saying no. */
function throwIfRefused(raw: unknown): void {
  const info = (raw as XtreamAuth | null)?.user_info;
  if (info && info.auth !== 1) throw new Error(refusal(info));
}

/** A category list, any kind: live, movies or shows answer in one shape. A
 * non-list is no folders, except that the movies' and shows' are `strict`
 * about a refusal: a lapsed account must not read as a library with none. */
async function fetchCategories(
  p: XtreamPlaylist,
  url: string,
  strict = false,
): Promise<XtreamCategory[]> {
  const raw = await httpGetJson<
    Array<{
      category_id?: string | number;
      category_name?: string;
      is_adult?: number | string | null;
    }>
  >(url, asked(p));
  if (!Array.isArray(raw)) {
    if (strict) throwIfRefused(raw);
    return [];
  }
  return raw
    .filter((c) => c.category_id != null)
    .map((c) => ({
      id: String(c.category_id),
      name: c.category_name || String(c.category_id),
      adult: Number(c.is_adult) === 1,
    }));
}

export async function fetchLiveCategories(
  p: XtreamPlaylist,
): Promise<XtreamCategory[]> {
  return fetchCategories(p, liveCategoriesUrl(p));
}

export async function fetchLiveStreams(
  p: XtreamPlaylist,
): Promise<XtreamStream[]> {
  const raw = await httpGetJson<XtreamStream[]>(liveStreamsUrl(p), asked(p));
  if (!Array.isArray(raw)) throw notAList(raw);
  return raw.filter((s) => s.stream_id != null);
}

// A provider's movies and shows (plan 028). These answer raw: the numbers come
// as numbers or strings and fields go missing, and features/xtvod reads them.
// Movie folders and show folders are two lists, and a movie folder and a show
// folder can share an id.

/** A whole-library list is megabytes (one provider's movie list is 10.2 MB and
 * took 4.1 s on a fast line), and the client's 30 seconds default starved the
 * guide the same way (see fetchXmltv). */
const LIST_TIMEOUT_SECS = 120;

/** Raw entries of a list call: the array. A lapsed account's sign-in object is
 * an error, not an empty library; anything else that is not a list (an error
 * object, a bare string) is none, as a live-only panel may answer. An empty
 * read where there were titles is refused later (vod.ts `fetchLists`). */
const entries = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  throwIfRefused(raw);
  return [];
};

export async function fetchVodCategories(
  p: XtreamPlaylist,
): Promise<XtreamCategory[]> {
  return fetchCategories(p, playerApiUrl(p, { action: "get_vod_categories" }), true);
}

export async function fetchSeriesCategories(
  p: XtreamPlaylist,
): Promise<XtreamCategory[]> {
  return fetchCategories(
    p,
    playerApiUrl(p, { action: "get_series_categories" }),
    true,
  );
}

/** Every movie the account holds, as the panel sent them. */
export async function fetchVodStreams(p: XtreamPlaylist): Promise<unknown[]> {
  return entries(
    await httpGetJson<unknown>(
      playerApiUrl(p, { action: "get_vod_streams" }),
      asked(p),
      { timeoutSecs: LIST_TIMEOUT_SECS },
    ),
  );
}

/** Every show the account holds, as the panel sent them. */
export async function fetchSeries(p: XtreamPlaylist): Promise<unknown[]> {
  return entries(
    await httpGetJson<unknown>(
      playerApiUrl(p, { action: "get_series" }),
      asked(p),
      { timeoutSecs: LIST_TIMEOUT_SECS },
    ),
  );
}

/** One movie's page: `{ info, movie_data }`, whatever the panel sent (an
 * empty array for an id it does not have). */
export async function fetchVodInfo(
  p: XtreamPlaylist,
  vodId: string | number,
): Promise<unknown> {
  return httpGetJson<unknown>(
    playerApiUrl(p, { action: "get_vod_info", vod_id: String(vodId) }),
    asked(p),
  );
}

/** One show's page: `{ info, episodes }`, whatever the panel sent. */
export async function fetchSeriesInfo(
  p: XtreamPlaylist,
  seriesId: string | number,
): Promise<unknown> {
  return httpGetJson<unknown>(
    playerApiUrl(p, {
      action: "get_series_info",
      series_id: String(seriesId),
    }),
    asked(p),
  );
}

/** The full XMLTV EPG for the account — one document, all channels.
 * Three-minute timeout: the document is tens of MB and the client's 30s
 * default starved it on slower links (EPG silently empty for those users
 * while channels worked — the Telly-loads-it-we-don't signature). */
export function fetchXmltv(p: XtreamPlaylist): Promise<ArrayBuffer> {
  // Bytes: the guide's worker decodes them (xmltvThread.ts).
  return httpGetBytes(xmltvUrl(p), asked(p), 180);
}
