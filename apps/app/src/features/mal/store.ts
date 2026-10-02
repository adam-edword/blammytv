import { load, remove, save } from "../../lib/storage";
import { forgetMalWatched } from "../stream/watched";

/**
 * MAL's bookkeeping on this device (plan 021). The session itself is in
 * Credential Manager (mal.rs); this is what the page keeps: your list's
 * episode counts, from the last sync, and progress MAL has not taken yet.
 */
export interface MalState {
  /** When the last sync finished; null until one has. */
  lastSync: number | null;
  /** MAL id → episodes watched, for every entry above 0. */
  counts: Record<string, number>;
  /** MAL id → the episode to send, for progress MAL could not take when
   * it happened (offline, or MAL down). Sent at the next sync. */
  pending: Record<string, number>;
  /** The last sync's problem, in words. */
  problem: string | null;
}

const KEY = "mal";
const VERSION = 1;
const EMPTY: MalState = { lastSync: null, counts: {}, pending: {}, problem: null };

export function loadMal(): MalState {
  return { ...EMPTY, ...load<Partial<MalState>>(KEY, VERSION, {}) };
}

export function saveMal(patch: Partial<MalState>): void {
  save(KEY, VERSION, { ...loadMal(), ...patch });
}

/** Signed out: the counts and their ticks go. */
export function forgetMal(): void {
  remove(KEY);
  forgetMalWatched();
}

/** Said when MAL's counts changed, so an open series page re-reads its
 * ticks and Settings its line. */
export const MAL_SYNCED = "blammytv:mal-synced";
