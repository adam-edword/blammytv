import { traktJson } from "../trakt/client";
import { imdbOf } from "../trakt/ids";
import type { ListEntry } from "../stream/myList";
import type { TraktList } from "./layout";

/**
 * Home's Trakt rows (plan 033, phase 3): Trakt's own trending and popular
 * lists, asked through `traktJson` like the rest of the Trakt code. Public
 * lists, but the request goes out the way every Trakt call does, so a build
 * with no keys, or nobody signed in, gets no row.
 *
 * What comes back is shaped into Library entries (an IMDb id, a title, a
 * kind, a year), the same as the Trakt Watchlist's, so a row draws and opens
 * the way a Library list does. Trakt sends no artwork; the card falls back to
 * its lettermark, as the watchlist's do.
 */

export const TRAKT_NAMES: Record<TraktList, string> = {
  trending_movies: "Trending Movies",
  trending_shows: "Trending Shows",
  popular_movies: "Popular Movies",
  popular_shows: "Popular Shows",
};

const PATHS: Record<TraktList, string> = {
  trending_movies: "/movies/trending",
  trending_shows: "/shows/trending",
  popular_movies: "/movies/popular",
  popular_shows: "/shows/popular",
};

interface TraktTitle {
  title?: string;
  year?: number | null;
  ids?: { imdb?: string | null };
}

/** Trending wraps each title (`{ watchers, movie }`, `{ watchers, show }`);
 * popular sends the title bare. */
type TraktItem = TraktTitle & { movie?: TraktTitle; show?: TraktTitle };

/**
 * Trakt's answer as Library entries, in the order it sent them. A title with
 * no IMDb id is dropped (every title here is keyed by one, ids.ts), and so is
 * one seen twice. Anything that is not a list gives nothing.
 */
export function shapeTrakt(list: TraktList, data: unknown): ListEntry[] {
  if (!Array.isArray(data)) return [];
  const kind = list.endsWith("movies") ? "movie" : "series";
  const seen = new Set<string>();
  const out: ListEntry[] = [];
  for (const raw of data as TraktItem[]) {
    const t = raw && typeof raw === "object" ? (raw.movie ?? raw.show ?? raw) : null;
    const id = t && typeof t.ids?.imdb === "string" ? imdbOf(t.ids.imdb) : null;
    if (!t || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: typeof t.title === "string" && t.title ? t.title : id,
      kind,
      ...(typeof t.year === "number" ? { year: t.year } : {}),
      at: 0,
    });
  }
  return out;
}

/** The list's titles, or null when Trakt did not answer with a list. */
export async function fetchTraktRow(list: TraktList, limit: number): Promise<ListEntry[] | null> {
  try {
    const r = await traktJson<unknown>("GET", `${PATHS[list]}?limit=${limit}`);
    return r.data === null ? null : shapeTrakt(list, r.data);
  } catch {
    return null;
  }
}
