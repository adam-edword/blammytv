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
}

/** Raw live stream entry, straight off the panel. */
export interface XtreamStream {
  stream_id: number | string;
  name?: string;
  stream_icon?: string | null;
  epg_channel_id?: string | null;
  category_id?: string | number | null;
}

interface XtreamAuth {
  user_info?: { auth?: number; status?: string; message?: string };
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
    Array<{ category_id?: string | number; category_name?: string }>
  >(liveCategoriesUrl(p));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c.category_id != null)
    .map((c) => ({
      id: String(c.category_id),
      name: c.category_name || String(c.category_id),
    }));
}

export async function fetchLiveStreams(
  p: XtreamPlaylist,
): Promise<XtreamStream[]> {
  const raw = await httpGetJson<XtreamStream[]>(liveStreamsUrl(p));
  return Array.isArray(raw) ? raw.filter((s) => s.stream_id != null) : [];
}

/** The full XMLTV EPG for the account — one document, all channels. */
export function fetchXmltv(p: XtreamPlaylist): Promise<string> {
  return httpGetText(xmltvUrl(p));
}
