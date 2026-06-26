/** Recently-played live channels, most-recent-first, stored on-device.
 * Deduped and capped — the Recents guide renders them in this order. */
const KEY = "blammytv.recents";
const MAX = 20;

export function loadRecents(): string[] {
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

/** Record a channel as just-played; returns the new ordered list (it moves to
 * the front, deduped, capped at {@link MAX}). */
export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}
