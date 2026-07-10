/**
 * The single seam over localStorage. Every persisted key lives here, and
 * values are wrapped in a { v, data } envelope so a future shape change has
 * one place to migrate. Storage failures (private mode, quota) degrade to
 * in-memory defaults — the app keeps working, it just won't persist.
 */

const PREFIX = "blammytv.";

interface Envelope<T> {
  v: number;
  data: T;
}

export function load<T>(key: string, version: number, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const env = JSON.parse(raw) as Envelope<T>;
    // No migrations yet: an unknown version just falls back to defaults.
    if (env.v !== version) return fallback;
    return env.data;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, version: number, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: version, data }));
  } catch {
    /* storage unavailable — it just won't persist */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable — nothing to remove */
  }
}
