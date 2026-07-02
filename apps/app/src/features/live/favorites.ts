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
