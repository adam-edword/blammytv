/**
 * What a Jellyfin item is called in BlammyTV (plan 027, batch 2).
 *
 * Everything downstream keys a title by its Stremio id: Continue Watching, the
 * watched ledgers, Trakt, MAL. A Jellyfin item keeps its own 32-hex id on the
 * server, so this file is the one place the two meet:
 *
 *   a film or show with an IMDb id   `tt0111161`
 *   an episode of one                `tt11280740:1:1`  (the SHOW's IMDb id, then
 *                                    the season and the episode number)
 *   anything else                    `jf:<the item's own id>`
 *
 * Only IMDb is used. TMDB and TVDB ids are on the items too, but nothing
 * downstream reads a `tmdb:` or `tvdb:` key (only `tt…` and `kitsu:` are known),
 * so a title with just those would be keyed by something that reads nowhere; its
 * own `jf:` id is the honest key. That has a cost, and it is accepted: such a
 * title does not share its watched state, Trakt scrobbles or Continue Watching
 * with the same title from any other source, and the same film held on two
 * servers is two entries. An episode's own IMDb id is never used: it
 * names the episode, and Stremio's episode id is the show's id plus numbers.
 *
 * A `tt…` key is shared with every other source that knows the title, which is
 * the point (watched state follows the title), and it means the key does NOT
 * say which Jellyfin item it is. The page keeps that in its own map; a `jf:`
 * key carries it.
 */

import { HEX32, type JfItem } from "./items";

const IMDB = /^tt\d+$/;
const PREFIX = "jf:";

/** The title's IMDb id as the server holds it, or null. */
export function imdbOf(item: JfItem): string | null {
  const v = item.ProviderIds?.Imdb ?? item.ProviderIds?.imdb;
  return typeof v === "string" && IMDB.test(v) ? v : null;
}

/** `jf:<id>` for an item id, null when it is not one. */
export function opaqueId(jellyfinId: string | undefined): string | null {
  return typeof jellyfinId === "string" && HEX32.test(jellyfinId) ? PREFIX + jellyfinId : null;
}

/** The Jellyfin id a `jf:` key carries, or null for any other key. */
export function jellyfinIdOfKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  const hex = key.slice(PREFIX.length);
  return HEX32.test(hex) ? hex : null;
}

/** A film's or a show's key. Null for any other item, or one without a usable
 * Jellyfin id: a title the server cannot be asked about is not one to list,
 * IMDb id or not. */
export function titleKey(item: JfItem): string | null {
  if (item.Type !== "Movie" && item.Type !== "Series") return null;
  if (!item.Id || !HEX32.test(item.Id)) return null;
  return imdbOf(item) ?? opaqueId(item.Id);
}

/** What an item is, in BlammyTV's ids. `id` is always the title's key, the key
 * Continue Watching and the ledgers use: a film's or a show's own, and for an
 * episode its series' (so it equals `seriesId`). */
export interface ItemRef {
  id: string;
  kind: "movie" | "series" | "episode";
  /** An episode's own Stremio id (`tt…:S:E`, or `jf:<its id>`). */
  episodeId?: string;
  seriesId?: string;
  season?: number;
  episode?: number;
}

/**
 * What a series' Jellyfin id is called: its key, `null` for one the page knows
 * is not a title it can show, `undefined` for one it has not read yet. An
 * episode comes in lists that name its show only by `SeriesId` (Resume, Next
 * Up), so its key cannot be told from the episode alone: the page reads the
 * show once (`/Items/{id}`, with `ProviderIds`), remembers it, and asks again.
 * An unread series is `undefined` here and never guessed from the episode,
 * because a show with an IMDb id would get a `jf:` key by mistake and its
 * watched state would split in two.
 */
export type SeriesKeyOf = (seriesJellyfinId: string) => string | null | undefined;

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** An episode's Stremio id under its show's key. A show with an IMDb key gives
 * `tt…:S:E`; an opaque one gives the episode its own `jf:` id, as a video's id
 * may be anything and its season and number ride beside it. Null without a
 * season and a number, or an id. */
export function episodeKey(ep: JfItem, seriesKey: string): string | null {
  if (!isNum(ep.ParentIndexNumber) || !isNum(ep.IndexNumber)) return null;
  if (IMDB.test(seriesKey)) return `${seriesKey}:${ep.ParentIndexNumber}:${ep.IndexNumber}`;
  return opaqueId(ep.Id);
}

/**
 * One item as a ref, or null when it is not a film, show or episode, has no
 * usable id, or (an episode) its show has not been read yet or is not a title.
 */
export function refOf(item: JfItem, seriesKeyOf: SeriesKeyOf): ItemRef | null {
  if (!item.Id || !HEX32.test(item.Id)) return null;
  if (item.Type === "Movie") {
    const id = titleKey(item);
    return id ? { id, kind: "movie" } : null;
  }
  if (item.Type === "Series") {
    const id = titleKey(item);
    return id ? { id, kind: "series" } : null;
  }
  if (item.Type === "Episode") {
    if (!item.SeriesId || !HEX32.test(item.SeriesId)) return null;
    const seriesId = seriesKeyOf(item.SeriesId);
    if (!seriesId) return null;
    const episodeId = episodeKey(item, seriesId);
    if (!episodeId) return null;
    return {
      id: seriesId,
      kind: "episode",
      episodeId,
      seriesId,
      season: item.ParentIndexNumber as number,
      episode: item.IndexNumber as number,
    };
  }
  return null;
}
