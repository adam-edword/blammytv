import type { VodItem } from "../stream/model";

/**
 * "Give me something to watch."
 *
 * The engine only. It takes a pool that somebody else assembled and answers
 * two questions: which of these fit, and which one are we watching. No
 * fetching, no React, no storage — so it is testable, and so the UI can be
 * designed around it rather than the other way round.
 */

export interface PickFilters {
  /** Empty means "any genre at all". */
  genres: string[];
  /** Out of 10, matching VodItem.rating. Undefined means no floor. */
  minRating?: number;
  /** Undefined means both. */
  kind?: "movie" | "series";
}

/**
 * Which rule got us this shortlist.
 *
 * "all" is what was asked for: every chosen genre present on the title.
 * "any" is the relaxation, and the UI has to be able to SAY it relaxed —
 * silently widening a filter is how a picker starts feeling broken
 * ("I said Horror AND Comedy, why is this a war film").
 */
export type MatchMode = "all" | "any";

export interface Shortlist {
  items: VodItem[];
  mode: MatchMode;
  /** True when "all" found nothing and "any" is what is on screen. */
  relaxed: boolean;
}

/** Case- and spacing-insensitive, because catalogs disagree about both
 * ("Sci-Fi", "sci fi", "Science Fiction" is a different problem and not
 * one this solves). */
const norm = (s: string): string => s.trim().toLowerCase();

function passesNonGenre(item: VodItem, f: PickFilters): boolean {
  if (f.kind && item.kind !== f.kind) return false;
  if (f.minRating != null) {
    // AN ITEM WITH NO RATING FAILS A RATING FLOOR, deliberately. "At least
    // 7 stars" is a promise, and an unrated title cannot keep it. Coverage
    // is spotty enough that this visibly shrinks the pool, which is the
    // honest outcome: the alternative is a picker that answers a quality
    // question with titles it knows nothing about.
    if (item.rating == null) return false;
    if (item.rating < f.minRating) return false;
  }
  return true;
}

/**
 * The pool that fits, strict first.
 *
 * ALL, then ANY. Adam's call, and it is the right default: an intersection
 * of three genres is usually empty, so a picker that only did "all" would
 * spend most of its life saying no. Falling back keeps it useful without
 * making "all" a lie when it does work.
 *
 * The non-genre filters are NOT relaxed. Widening a genre is a suggestion;
 * widening a rating floor or a type is ignoring what was asked.
 */
export function shortlist(
  items: readonly VodItem[],
  filters: PickFilters,
): Shortlist {
  const base = items.filter((i) => passesNonGenre(i, filters));
  const want = filters.genres.map(norm).filter(Boolean);
  if (want.length === 0) return { items: base, mode: "all", relaxed: false };

  const has = (item: VodItem, g: string): boolean =>
    item.genres.some((x) => norm(x) === g);

  const all = base.filter((i) => want.every((g) => has(i, g)));
  if (all.length > 0) return { items: all, mode: "all", relaxed: false };

  const any = base.filter((i) => want.some((g) => has(i, g)));
  return { items: any, mode: "any", relaxed: any.length > 0 };
}

/**
 * How many recent picks to avoid repeating.
 *
 * Small on purpose. The point is "not the same three films every time",
 * not a permanent history — and a long memory makes a narrow shortlist
 * unusable, because everything in it is "recent".
 */
export const RECENT_KEEP = 12;

/**
 * One at random, avoiding what was just offered.
 *
 * `rng` is injected so this is testable. A picker verified by running it
 * a thousand times and eyeballing the spread is not verified.
 *
 * FALLS BACK TO THE WHOLE POOL when everything in it is recent. The
 * alternative is returning null for a shortlist that plainly has items in
 * it, which reads as "no results" and is simply wrong — with three
 * matching films, the fourth press has to give you one of them again.
 */
/*
 * GENERIC OVER `{ id }`, not tied to VodItem, and the reason is the TMDB
 * path. There the pool is a list of NAMES that TMDB thinks match, and only
 * the one that gets picked is resolved against the user's addons into
 * something playable — resolving twenty to throw away nineteen would be
 * twenty searches a press. So the thing being picked from is not a VodItem
 * yet, and this function never cared: an id is all it reads.
 */
export function pick<T extends { id: string }>(
  pool: readonly T[],
  recent: readonly string[] = [],
  rng: () => number = Math.random,
): T | null {
  if (pool.length === 0) return null;
  const skip = new Set(recent);
  const fresh = pool.filter((i) => !skip.has(i.id));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
}

/** Push an id onto the recent list, newest first, capped. */
export function remember(
  recent: readonly string[],
  id: string,
): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_KEEP);
}

/**
 * The genres actually worth offering, and how many titles each would give.
 *
 * A picker whose genre list comes from the catalog MANIFEST offers moods
 * that match nothing — the manifest advertises what a catalog can filter
 * by, not what is in the pool you are about to draw from. Counting the
 * pool instead means every chip on screen can produce a result.
 */
export function genreCounts(items: readonly VodItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items)
    for (const g of item.genres) {
      const k = g.trim();
      if (k) out.set(k, (out.get(k) ?? 0) + 1);
    }
  return out;
}
