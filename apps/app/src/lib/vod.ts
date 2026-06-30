import type { ShareCode, StreamSource, VodItem } from "@blammytv/shared";
import { isTauri } from "./tauri";
import { getAioUrl } from "./settings";
import { resolveSources, resolveVodItem, searchVod } from "./aiostreams";

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

/** Whether VOD can be fetched on-demand: on the desktop app, once an AIOStreams
 * URL is set; in the browser, when a dev backend is configured. */
export const vodBackendConfigured = (): boolean =>
  isTauri() ? Boolean(getAioUrl()) : Boolean(API_URL);

async function get<T>(path: string, code: ShareCode): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${code}` },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

/** On-demand title detail: synopsis, cast, and (for series) seasons/episodes.
 * Catalog items in the blob are lightweight; this fills one in when opened. */
export async function fetchVodDetail(
  code: ShareCode,
  kind: VodItem["kind"],
  id: string,
): Promise<VodItem | null> {
  if (isTauri()) {
    const url = getAioUrl();
    return url ? resolveVodItem(url, kind, id) : null;
  }
  const { item } = await get<{ item?: VodItem }>(`/vod/${kind}/${id}`, code);
  return item ?? null;
}

/** On-demand ranked playable sources for a movie (`tt123`) or episode
 * (`tt123:1:2`), resolved through AIOStreams. */
export async function fetchVodSources(
  code: ShareCode,
  kind: VodItem["kind"],
  id: string,
): Promise<StreamSource[]> {
  if (isTauri()) {
    const url = getAioUrl();
    return url ? resolveSources(url, kind, id) : [];
  }
  const { sources } = await get<{ sources?: StreamSource[] }>(
    `/sources/${kind}/${id}`,
    code,
  );
  return sources ?? [];
}

/** Search VOD titles by query — through AIOStreams' search catalogs on the
 * desktop app, or the dev backend in the browser. */
export async function searchVodTitles(
  code: ShareCode,
  query: string,
): Promise<VodItem[]> {
  const q = query.trim();
  if (!q) return [];
  if (isTauri()) {
    const url = getAioUrl();
    return url ? searchVod(url, q) : [];
  }
  const { items } = await get<{ items?: VodItem[] }>(
    `/search?q=${encodeURIComponent(q)}`,
    code,
  );
  return items ?? [];
}

/** Build an id → item lookup across the movies + series catalogs, so Stream
 * rows (which reference ids) can resolve their items. */
export function vodCatalog(
  movies: VodItem[],
  series: VodItem[],
): Map<string, VodItem> {
  const map = new Map<string, VodItem>();
  for (const item of movies) map.set(item.id, item);
  for (const item of series) map.set(item.id, item);
  return map;
}

/** "9.0 · 2026 · 152 min" — drops whichever pieces are missing. */
export function formatMeta(item: VodItem): string {
  const parts: string[] = [];
  if (item.rating != null) parts.push(item.rating.toFixed(1));
  if (item.year != null) parts.push(String(item.year));
  if (item.runtimeMin != null) parts.push(`${item.runtimeMin} min`);
  return parts.join(" · ");
}

/** Up-to-two-letter monogram for placeholder artwork. */
export function initials(title: string): string {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Deterministic placeholder backdrop gradient from an id (stable per title),
 * used by the hero and detail page until real artwork exists. */
export function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(120deg, hsl(${hue} 38% 28%), hsl(${(hue + 40) % 360} 32% 14%))`;
}
