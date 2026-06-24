/**
 * Minimal Stremio addon-protocol types — the subset BlammyTV consumes from an
 * AIOStreams manifest (or any Stremio-compatible addon).
 *
 * Endpoints, relative to the manifest's base URL:
 *   /catalog/{type}/{id}.json           → { metas: MetaPreview[] }
 *   /catalog/{type}/{id}/{extra}.json    → filtered / paged catalog
 *   /meta/{type}/{id}.json               → { meta: MetaDetail }
 *   /stream/{type}/{id}.json             → { streams: Stream[] }
 */

export interface AddonManifest {
  id: string;
  name: string;
  version?: string;
  resources: Array<
    string | { name: string; types?: string[]; idPrefixes?: string[] }
  >;
  types?: string[];
  catalogs: CatalogDef[];
}

export interface CatalogDef {
  type: string;
  id: string;
  name?: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
}

/** A lightweight catalog entry — what fills the browse grid. */
export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: string;
  releaseInfo?: string | number;
  imdbRating?: string | number;
  genres?: string[];
  description?: string;
}

/** Full title detail — what powers the detail page. */
export interface MetaDetail extends MetaPreview {
  background?: string;
  logo?: string;
  landscapePoster?: string;
  runtime?: string;
  director?: string;
  year?: string | number;
  cast?: Array<{ name: string; character?: string; photo?: string }> | string[];
  /** Series only: the flat episode list across all seasons. */
  videos?: Video[];
}

/** One episode entry in a series' `videos` list. */
export interface Video {
  /** Stream id for this episode, e.g. "tt0903747:1:1" ({title}:{season}:{episode}). */
  id: string;
  title?: string;
  name?: string;
  season: number;
  episode: number;
  released?: string | null;
  thumbnail?: string;
  overview?: string;
  runtime?: string;
  /** false ⇒ unreleased / unavailable; we drop these from the season list. */
  available?: boolean;
}

/** One resolved playable source for a title/episode (already debrid-ranked). */
export interface Stream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  behaviorHints?: {
    bingeGroup?: string;
    videoSize?: number;
    filename?: string;
  };
}

export interface CatalogResponse {
  metas?: MetaPreview[];
}
export interface MetaResponse {
  meta?: MetaDetail;
}
export interface StreamResponse {
  streams?: Stream[];
}
