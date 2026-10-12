/**
 * The single seam over localStorage. Every persisted key lives here, and
 * values are wrapped in a { v, data } envelope so a future shape change has
 * one place to migrate. Storage failures (private mode, quota) degrade to
 * in-memory defaults — the app keeps working, it just won't persist.
 */

const PREFIX = "blammytv.";

export interface Envelope<T> {
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

/**
 * A stored LIST, checked for being one. `load`'s type parameter is a
 * promise nobody keeps: a value edited by hand, or left by a build that
 * stored a different shape under the same version, came back as whatever
 * it was, and a `.some` on it at boot (App asks for the playlists before
 * anything renders) was a blank window with no way back in. Items that
 * aren't the right shape are dropped; the rest are kept.
 */
export function loadList<T>(key: string, version: number, isItem: (x: unknown) => x is T): T[] {
  const v = load<unknown>(key, version, []);
  return Array.isArray(v) ? v.filter(isItem) : [];
}

export const isString = (x: unknown): x is string => typeof x === "string";

/** An object with a string `id`: the least every stored record has. */
export const hasId = <T,>(x: unknown): x is T =>
  typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string";

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

/** Whether a parsed value is an envelope: `{ v: number, data }`. The check the
 * settings file makes of every value it reads or is given, and no more. */
export function isEnvelope(x: unknown): x is Envelope<unknown> {
  return (
    typeof x === "object" &&
    x !== null &&
    !Array.isArray(x) &&
    typeof (x as { v?: unknown }).v === "number" &&
    Number.isFinite((x as { v: number }).v) &&
    "data" in x
  );
}

/**
 * The stored text of a key as it sits on disk, envelope and all, or null when
 * there is none (or the store cannot be read). For the settings file
 * (features/settings/settingsExport.ts), which moves envelopes between
 * machines and so has to see them whole; everything else reads through `load`.
 */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * Put a key's stored text back as it was, or take the key away with null.
 * False when the store refused (quota, private mode). Silent: unlike `save`,
 * it logs nothing, because what it is writing is the person's file and the
 * log is not a place for it. The caller says what happened.
 */
export function writeRaw(key: string, raw: string | null): boolean {
  try {
    if (raw === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, raw);
    return true;
  } catch {
    return false;
  }
}
