import { useSyncExternalStore } from "react";
import type { VodItem } from "@blammytv/shared";

/** Continue Watching: a small, locally-stored (localStorage) list of in-progress
 * titles, most-recent first. Entries are dropped once watched past 90%. Progress
 * (position/duration) is filled in by the player; until the native player
 * reports position this stays 0 and the card shows no bar. */

const KEY = "blammy.continueWatching.v1";
const CAP = 12;
const DONE_PCT = 0.9; // drop an entry once it's watched this far

export interface CwEntry {
  /** VodItem id (the title). One entry per title — a series collapses to its
   * latest-watched episode. */
  id: string;
  kind: VodItem["kind"];
  /** For a series, the specific episode being watched. */
  episodeId?: string;
  title: string;
  /** Landscape art for the card (falls back to the poster). */
  backdrop?: string;
  positionSec: number;
  durationSec: number;
  /** ms epoch — recency ordering. */
  updatedAt: number;
}

function read(): CwEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as CwEntry[]) : [];
  } catch {
    return [];
  }
}

// Cached snapshot so `useSyncExternalStore` gets a stable reference between
// changes (recomputed only on write).
let snapshot: CwEntry[] = sortCap(read());

function sortCap(entries: CwEntry[]): CwEntry[] {
  return entries
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CAP);
}

function commit(entries: CwEntry[]): void {
  snapshot = sortCap(entries);
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage full / unavailable — keep the in-memory snapshot anyway */
  }
  listeners.forEach((l) => l());
}

/** Most-recent-first, capped. Stable reference until the list changes. */
export const listContinueWatching = (): CwEntry[] => snapshot;

/** Fraction watched (0..1); 0 when the duration isn't known yet. */
export const progressPct = (e: CwEntry): number =>
  e.durationSec > 0 ? Math.min(1, e.positionSec / e.durationSec) : 0;

/** Insert or refresh a title's entry. Watching past 90% drops it instead. */
export function upsertContinueWatching(
  entry: Omit<CwEntry, "updatedAt"> & { updatedAt?: number },
): void {
  const rest = read().filter((e) => e.id !== entry.id);
  const done =
    entry.durationSec > 0 && entry.positionSec / entry.durationSec >= DONE_PCT;
  commit(
    done ? rest : [{ ...entry, updatedAt: entry.updatedAt ?? Date.now() }, ...rest],
  );
}

export function removeContinueWatching(id: string): void {
  commit(read().filter((e) => e.id !== id));
}

const listeners = new Set<() => void>();
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React binding — re-renders when the list changes. */
export function useContinueWatching(): CwEntry[] {
  return useSyncExternalStore(subscribe, listContinueWatching, () => snapshot);
}
