import type { VodItem } from "../stream/model";
import { resolveVodItem } from "../stream/source";
import { interleave, itemKey } from "./data";
import { TMDB_PARALLEL, TMDB_ROW } from "./genreRows";
import {
  discoverByKeywords,
  genreIds,
  imdbIdFor,
  tmdbEnabled,
  type TmdbCandidate,
} from "./tmdb";
import type { TypeFilter } from "./typeFilter";

/**
 * "Popular {Genre}": TMDB's most popular titles in the genre, each found in
 * the user's own addons (plan 034).
 *
 * The same chain the recommender walks (Recommender.tsx): TMDB names a title,
 * `imdbIdFor` turns it into an IMDb id, `resolveVodItem` asks the addons for
 * it. What comes back is the addon's item, never TMDB's. A title the addons
 * do not have, or a lookup that fails, is left out; one bad title does not
 * end the row.
 *
 * Nothing here for a Series filter, or without a TMDB key. Any asks for
 * films and shows both and alternates them; Movies asks for films.
 */

export interface TmdbDeps {
  enabled: () => boolean;
  /** TMDB's genre name -> id list for a type. */
  genreIds: (kind: "movie" | "series") => Promise<Map<string, number>>;
  /** Popular titles in a genre, most popular first. */
  popular: (genre: number, kind: "movie" | "series") => Promise<TmdbCandidate[]>;
  imdbId: (c: TmdbCandidate) => Promise<string | null>;
  resolve: (kind: "movie" | "series", imdb: string) => Promise<VodItem | null>;
}

const REAL: TmdbDeps = {
  enabled: tmdbEnabled,
  genreIds,
  // /discover/{movie|tv}?with_genres=<id>&sort_by=popularity.desc
  popular: (genre, kind) => discoverByKeywords([], kind, "all", [genre]),
  imdbId: imdbIdFor,
  resolve: (kind, imdb) => resolveVodItem(kind, imdb),
};

/** `live` says whether anyone still wants the answer. The page's 8s wait only
 * drops the result, so without it a genre the user has left keeps asking for
 * its forty-odd lookups; once it reads false no further request goes out
 * (those already on the wire finish). */
export async function popularInGenre(
  genre: string,
  filter: TypeFilter,
  deps: TmdbDeps = REAL,
  live: () => boolean = () => true,
): Promise<VodItem[]> {
  if (filter === "series" || !deps.enabled()) return [];
  const kinds: ("movie" | "series")[] = filter === "movie" ? ["movie"] : ["movie", "series"];
  const lists = await Promise.all(
    kinds.map(async (kind) => {
      const id = (await deps.genreIds(kind).catch(() => null))?.get(genre.trim().toLowerCase());
      return id == null || !live() ? [] : await deps.popular(id, kind).catch(() => []);
    }),
  );
  const first = interleave(...lists).slice(0, TMDB_ROW);

  // A few at a time: each is two requests, and twenty at once is a burst
  // the addon did not ask for.
  const found: (VodItem | null)[] = first.map(() => null);
  let next = 0;
  const worker = async () => {
    for (let at = next++; at < first.length && live(); at = next++) {
      const imdb = await deps.imdbId(first[at]).catch(() => null);
      if (imdb) found[at] = await deps.resolve(first[at].kind, imdb).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(TMDB_PARALLEL, first.length) }, worker));

  const seen = new Set<string>();
  return found.filter((i): i is VodItem => {
    if (!i || seen.has(itemKey(i))) return false;
    seen.add(itemKey(i));
    return true;
  });
}
