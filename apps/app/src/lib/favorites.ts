/** Favorited live-channel ids, stored on-device. Order isn't meaningful (the
 * Favorites guide just filters channels by membership). */
const KEY = "blammytv.favorites";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function loadFavorites(): string[] {
  return read();
}

/** Toggle a channel's favorite state; returns the new list. */
export function toggleFavorite(id: string): string[] {
  const cur = read();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}
