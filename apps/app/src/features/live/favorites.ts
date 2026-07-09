import { load, save } from "../../lib/storage";

/** Starred channels (ids). Channels are favorited, not folders. */

const KEY = "favorites";
const VERSION = 1;

export function loadFavorites(): string[] {
  return load<string[]>(KEY, VERSION, []);
}

export function toggleFavorite(list: string[], id: string): string[] {
  const next = list.includes(id)
    ? list.filter((x) => x !== id)
    : [...list, id];
  save(KEY, VERSION, next);
  return next;
}

/** Move a favorite to a new index in the list (0-based), preserving the rest
 * of the order. The list IS the display order in Favorites mode, so this is
 * how the user hand-sorts their channels. Out-of-range/absent ids are no-ops
 * (returns a persisted copy regardless, so callers can treat it uniformly). */
export function reorderFavorite(
  list: string[],
  id: string,
  toIndex: number,
): string[] {
  const from = list.indexOf(id);
  if (from === -1) return list;
  const next = list.slice();
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, id);
  save(KEY, VERSION, next);
  return next;
}
