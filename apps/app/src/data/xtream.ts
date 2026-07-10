import { httpGetJson, httpGetText } from "../lib/http";
import type { XtreamPlaylist } from "../features/settings/playlists";

/**
 * Xtream Codes panel endpoints (`player_api.php` + `xmltv.php`). Panels are
 * loosely typed — numbers arrive as strings and fields go missing — so the
 * raw shapes are permissive and callers normalize. All fetches ride
 * `lib/http` (Rust-side in the app: panels send no CORS headers).
 */

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
 * player_api endpoint authenticate uses. Never throws: a failed poll
 * just hides the pill until the next one. */
export async function fetchConnections(
  p: XtreamPlaylist,
): Promise<XtreamConnections | null> {
  try {
    const auth = await httpGetJson<XtreamAuth>(playerApiUrl(p));
    return parseConnections(auth?.user_info);
  } catch {
    return null;
  }
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

export function liveStreamsUrl(p: XtreamPlaylist): string {
  return playerApiUrl(p, { action: "get_live_streams" });
}

export function xmltvUrl(p: XtreamPlaylist): string {
  const base = p.server.trim().replace(/\/+$/, "");
  const qs = new URLSearchParams({
    username: p.username,
    password: p.password,
  });
  return `${base}/xmltv.php?${qs}`;
}

/** Verify the account; throws if the panel rejects the credentials. */
export async function authenticate(p: XtreamPlaylist): Promise<void> {
  const auth = await httpGetJson<XtreamAuth>(playerApiUrl(p));
  if (auth?.user_info?.auth !== 1) {
    throw new Error(
      auth?.user_info?.message ??
        auth?.user_info?.status ??
        "the panel rejected the credentials",
    );
  }
}

export async function fetchLiveCategories(
  p: XtreamPlaylist,
): Promise<XtreamCategory[]> {
  const raw = await httpGetJson<
    Array<{
      category_id?: string | number;
      category_name?: string;
      is_adult?: number | string | null;
    }>
  >(liveCategoriesUrl(p));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c.category_id != null)
    .map((c) => ({
      id: String(c.category_id),
      name: c.category_name || String(c.category_id),
      adult: Number(c.is_adult) === 1,
    }));
}

export async function fetchLiveStreams(
  p: XtreamPlaylist,
): Promise<XtreamStream[]> {
  const raw = await httpGetJson<XtreamStream[]>(liveStreamsUrl(p));
  return Array.isArray(raw) ? raw.filter((s) => s.stream_id != null) : [];
}

/** The full XMLTV EPG for the account — one document, all channels.
 * Three-minute timeout: the document is tens of MB and the client's 30s
 * default starved it on slower links (EPG silently empty for those users
 * while channels worked — the Telly-loads-it-we-don't signature). */
export function fetchXmltv(p: XtreamPlaylist): Promise<string> {
  return httpGetText(xmltvUrl(p), undefined, 180);
}
