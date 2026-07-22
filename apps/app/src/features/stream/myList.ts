import { load, save } from "../../lib/storage";
import type { VodItem } from "./model";

/**
 * My List — user-saved titles, the Stream section's third page. Stores a
 * thin card-shaped snapshot (enough to paint the grid instantly, no
 * network round-trip); opening a card resolves fresh full meta the same
 * way Discover's hand-off does. Newest saves first.
 */

export interface ListEntry {
  id: string;
  title: string;
  kind: "movie" | "series";
  poster?: string;
  backdrop?: string;
  logo?: string;
  year?: number;
  rating?: number;
  runtimeMin?: number;
  /** Saved-at (grid order). */
  at: number;
}

const KEY = "myList";
const VERSION = 1;

export function loadMyList(): ListEntry[] {
  return load<ListEntry[]>(KEY, VERSION, []);
}

export function inMyList(id: string): boolean {
  return loadMyList().some((e) => e.id === id);
}

/** Add (front of the list) or remove; returns the new saved-state. */
export function toggleMyList(item: VodItem): boolean {
  const list = loadMyList();
  const idx = list.findIndex((e) => e.id === item.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    save(KEY, VERSION, list);
    return false;
  }
  const entry: ListEntry = {
    id: item.id,
    title: item.title,
    kind: item.kind,
    ...(item.poster ? { poster: item.poster } : {}),
    ...(item.backdrop ? { backdrop: item.backdrop } : {}),
    ...(item.logo ? { logo: item.logo } : {}),
    ...(item.year != null ? { year: item.year } : {}),
    ...(item.rating != null ? { rating: item.rating } : {}),
    ...(item.runtimeMin != null ? { runtimeMin: item.runtimeMin } : {}),
    at: Date.now(),
  };
  save(KEY, VERSION, [entry, ...list]);
  return true;
}
