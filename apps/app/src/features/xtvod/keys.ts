/**
 * What a provider's title is called in BlammyTV (plan 028).
 *
 * Continue Watching, My List and the watched marks all file a title by its key
 * and keep it on disk, so a key never changes shape once it has shipped:
 *
 *   a movie with a TMDB id      xt:<playlistId>:m:t<tmdbId>
 *   a movie without one         xt:<playlistId>:m:<stream_id>
 *   a show with a TMDB id       xt:<playlistId>:s:t<tmdbId>
 *   a show without one          xt:<playlistId>:s:<series_id>
 *   an episode                  the show's key, then :<season>:<episode>
 *
 * A TMDB id is what a title is filed by when there is one, because providers
 * re-upload and a stream id changes with it; a TMDB id does not. It is also
 * what folds the copies of a title (a 4K one beside a plain one) into one key.
 * A playlist removed and added again has a new id, so its keys start over.
 *
 * Only the keys this file makes are read back. `jf:…`, `tt…` and `kitsu:…`
 * come back null, so no other source's title is taken for one of these.
 *
 * Pure: no network, no storage.
 */

import type { XtCopy } from "./read";

export type XtKind = "movie" | "series";

/** What the two lists are called wherever a person reads them. */
export const KIND_WORD: Record<XtKind, string> = { movie: "Movies", series: "Shows" };

/** `m` for a movie, `s` for a show, in a key. */
const LETTER = { movie: "m", series: "s" } as const;

/** What a key says. `panelId` and `tmdb` are the alternatives: a key names a
 * title by one or the other. */
export interface XtKey {
  playlistId: string;
  kind: XtKind;
  /** The TMDB id, for a key made from one. */
  tmdb?: number;
  /** `stream_id` or `series_id`, for a key made from that. */
  panelId?: string;
  /** An episode's season and number; both or neither. */
  season?: number;
  episode?: number;
}

/** The key of a title made from this copy: by its TMDB id when it has one,
 * else by the panel's id. */
export function titleKey(playlistId: string, kind: XtKind, copy: Pick<XtCopy, "id" | "tmdb">): string {
  return `xt:${playlistId}:${LETTER[kind]}:${copy.tmdb !== undefined ? `t${copy.tmdb}` : copy.id}`;
}

/** An episode's key under its show's. */
export function episodeKey(showKey: string, season: number, episode: number): string {
  return `${showKey}:${season}:${episode}`;
}

// The playlist id is whatever has no colon (a UUID, or a short test id). A
// number is canonical: no sign, no leading zero, so one title has one key.
const KEY = /^xt:([^:]+):([ms]):(?:t([1-9]\d*)|([1-9]\d*))(?::(\d+):(\d+))?$/;

/** What a key names, or null for anything this file did not make: another
 * source's key, a malformed one, an episode of a movie. */
export function readKey(key: string): XtKey | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const kind: XtKind = m[2] === "m" ? "movie" : "series";
  const episode = m[5] !== undefined;
  if (episode && kind === "movie") return null;
  return {
    playlistId: m[1],
    kind,
    ...(m[3] !== undefined ? { tmdb: Number(m[3]) } : { panelId: m[4] }),
    ...(episode ? { season: Number(m[5]), episode: Number(m[6]) } : {}),
  };
}

/** The key of the title a key belongs to: a show's for an episode's, a title's
 * own for its own. Null for a key that is not one of these. */
export function titleOf(key: string): string | null {
  const k = readKey(key);
  if (!k) return null;
  return key.split(":").slice(0, 4).join(":");
}
