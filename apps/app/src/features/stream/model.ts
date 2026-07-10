/**
 * The Stream tab's domain model — movies and series from the user's
 * AIOStreams addon, one shape regardless of which catalog produced an item.
 * Mirrors the old build's shared VodItem schema (minus zod: the rebuild
 * validates by construction in the mapper).
 */

/** One resolved playable source. AIOStreams pre-ranks these — the app
 * renders them in the given order and never re-sorts or re-filters. */
export interface StreamSource {
  id: string;
  /** Prominent left label, e.g. "1080p" / "2160p". */
  quality: string;
  /** Instant-play (cached on debrid) — the ⚡ marker. */
  cached: boolean;
  /** Pre-formatted meta lines straight from the addon's formatter
   * (provider, languages, size, …) — formatter-agnostic, like Stremio. */
  lines: string[];
  /** Already-resolved, directly playable URL. */
  streamUrl: string;
  /** Stremio's binge key (`provider|resolution|codec…`): episode rolls
   * prefer a cached source from the SAME group, so the release (and its
   * tracks, bitrate, timing) stays consistent across an autoplay run. */
  bingeGroup?: string;
}

/** One episode of a series. Sources resolve on-demand, like a movie's. */
export interface Episode {
  id: string;
  number: number;
  title: string;
  /** Display-formatted air date (e.g. "Apr 30, 2026"). */
  airDate?: string;
  still?: string;
}

export interface Season {
  id: string;
  number: number;
  /** "Specials" for season 0, else "Season N". */
  name: string;
  episodes: Episode[];
}

export interface VodItem {
  id: string;
  title: string;
  kind: "movie" | "series";
  year?: number;
  poster?: string;
  /** Wide artwork for the hero / landscape cards. */
  backdrop?: string;
  /** Transparent "clearlogo" title art. */
  logo?: string;
  /** Out-of-10 rating. */
  rating?: number;
  runtimeMin?: number;
  synopsis?: string;
  genres: string[];
  cast: string[];
  /** Series only; empty until the detail resolves. */
  seasons: Season[];
}

/** A horizontally-scrolling row on the Stream home. */
export interface StreamRow {
  id: string;
  title: string;
  /** Card shape: tall posters (2:3) or wide stills (16:9). */
  layout: "poster" | "landscape";
  itemIds: string[];
}

export interface VodData {
  /** Everything browsable, keyed by id (movies + series in one map). */
  items: Map<string, VodItem>;
  rows: StreamRow[];
  /** Hero carousel item ids, enriched with backdrop/synopsis up-front. */
  featured: string[];
  /** Set when the catalog build failed wholesale (bad manifest URL, addon
   * down) — the tab renders a retry card instead of rows. */
  error?: string;
}
