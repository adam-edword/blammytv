/**
 * BlammyTV's ids in Trakt's terms (plan 015).
 *
 * Every title the app stores is keyed by its IMDb id (`tt1234567`), and an
 * episode by the series' id, its season and its number (`tt1234567:1:2`),
 * Stremio's shape. Trakt takes IMDb ids for films and shows, so those two
 * line up directly. A title from a catalog keyed by something else (Kitsu,
 * for anime) has no IMDb id and does not sync (decision D5): every function
 * here answers null for it rather than guessing.
 */

export interface TraktIds {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
}

const IMDB = /^tt\d+$/;
const EPISODE = /^(tt\d+):(\d+):(\d+)$/;

/** The IMDb id of a title, or null when it has none. */
export function imdbOf(id: string): string | null {
  return IMDB.test(id) ? id : null;
}

export interface EpisodeRef {
  show: string;
  season: number;
  number: number;
}

/** A Stremio episode id, taken apart. Null for one not keyed by IMDb. */
export function episodeRef(episodeId: string): EpisodeRef | null {
  const m = EPISODE.exec(episodeId);
  return m ? { show: m[1], season: Number(m[2]), number: Number(m[3]) } : null;
}

/** The app's episode id for a Trakt show and episode. */
export function episodeId(show: string, season: number, number: number): string {
  return `${show}:${season}:${number}`;
}
