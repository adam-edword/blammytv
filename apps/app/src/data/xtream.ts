import { httpGetJson } from "../lib/http";
import type { XtreamPlaylist } from "../features/settings/playlists";

/** Xtream Codes player API — category listing (the Live sidebar's folders). */

export interface XtreamCategory {
  id: string;
  name: string;
}

/** Pure URL builder, separated from the fetch for testability. */
export function liveCategoriesUrl(p: XtreamPlaylist): string {
  const base = p.server.trim().replace(/\/+$/, "");
  const qs = new URLSearchParams({
    username: p.username,
    password: p.password,
    action: "get_live_categories",
  });
  return `${base}/player_api.php?${qs}`;
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
