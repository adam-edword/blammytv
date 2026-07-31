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
  } catch (err) {
    // LOUDLY. A failed write is indistinguishable from a working one to
    // everything upstream, so a full quota silently stops persisting every
    // preference in the app: favourites, follows, settings, all of it, with
    // the UI still showing them saved until the next launch loses them.
    // The guide's disk cache already logs its write failures for exactly
    // this reason; this is the same instinct on the bigger store.
    console.warn(`[storage] could not persist ${key}`, err);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable — nothing to remove */
  }
}
