/**
 * A real Jellyfin server's answers, as the Stremio shapes Stream reads
 * (plan 027, batch 2). The shapes are from Jellyfin 12.2.0 as Adam's own
 * server sent them (`scripts/fixtures/jellyfin-12.2.json`, taken by
 * `scripts/jf-probe.mjs`), not from memory.
 *
 * Pure: no network, no storage, no token. Anything that does not decode comes
 * back null or is left out, never guessed.
 */

/** A Jellyfin `BaseItemDto`, the fields read. Everything is optional: it is
 * parsed JSON from a server that may be a different version. */
export interface JfItem {
  Id?: string;
  Type?: string;
  Name?: string;
  /** On a view: `movies`, `tvshows`, `music`, `boxsets`, `homevideos`, ...
   * A mixed library has none. */
  CollectionType?: string;
  SeriesId?: string;
  SeriesName?: string;
  /** An episode's number. */
  IndexNumber?: number;
  /** An episode's season (0 for specials). */
  ParentIndexNumber?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  RunTimeTicks?: number;
  Overview?: string;
  Genres?: string[];
  /** 0 to 10. */
  CommunityRating?: number;
  /** `Imdb`, `Tmdb`, `Tvdb`, ... Absent or empty when the metadata did not
   * match. An episode's own `Imdb` is the episode's, not its show's. */
  ProviderIds?: Record<string, string>;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  People?: { Name?: string; Type?: string }[];
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayCount?: number;
    Played?: boolean;
    LastPlayedDate?: string;
  };
}

/** 32 lower case hex: the shape every Jellyfin item id has, and the only one
 * `jf.rs` sends. */
export const HEX32 = /^[0-9a-f]{32}$/;

/** `${base}/Items/<id>/Images/<kind>?tag=<tag>`. Images need no token (probe
 * 2026-10-14: `200` with none); the tag is the image's address. Undefined when
 * the item has no such image or the id is not an item id. */
export function imageUrl(
  base: string,
  itemId: string | undefined,
  kind: string,
  tag: string | undefined,
): string | undefined {
  if (!itemId || !HEX32.test(itemId) || !tag) return undefined;
  return `${base.replace(/\/+$/, "")}/Items/${itemId}/Images/${kind}?tag=${encodeURIComponent(tag)}`;
}
