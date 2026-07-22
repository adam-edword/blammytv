import { httpGetJson } from "../lib/http";

/**
 * Minimal Stremio addon-protocol client — the subset BlammyTV consumes from
 * the user's AIOStreams instance (or any Stremio-compatible addon), ported
 * from the old build's battle-tested `lib/aiostreams/client.ts` + `types.ts`.
 *
 * Endpoints, relative to the manifest's base URL:
 *   /manifest.json                       → AddonManifest
 *   /catalog/{type}/{id}.json            → { metas: MetaPreview[] }
 *   /catalog/{type}/{id}/{extra}.json    → filtered / paged catalog
 *   /meta/{type}/{id}.json               → { meta: MetaDetail }
 *   /stream/{type}/{id}.json             → { streams: Stream[] }
 *
 * All fetches ride `lib/http` (Rust-side in the app): addon hosts behind
 * Cloudflare/WAFs 403 non-browser TLS fingerprints — the whole reason
 * http_get presents as a browser over Schannel. The manifest URL embeds the
 * user's addon config, so treat it like a credential: never log it.
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

/** A lightweight catalog entry — what fills the browse rows. */
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
  /** Cinemeta-style previews include it ("2h 49min" / "129 min"). */
  runtime?: string;
}

/** Full title detail — what powers the detail page. */
export interface MetaDetail extends MetaPreview {
  background?: string;
  logo?: string;
  landscapePoster?: string;
  director?: string;
  year?: string | number;
  cast?: Array<{ name: string; character?: string; photo?: string }> | string[];
  /** Modern Cinemeta-style metas carry people/genres as link objects
   * instead of (or alongside) the legacy arrays. */
  links?: Array<{ category?: string; name?: string; url?: string }>;
  /** Series only: the flat episode list across all seasons. */
  videos?: StremioVideo[];
}

/** One episode entry in a series' `videos` list. */
export interface StremioVideo {
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
  /** false ⇒ unreleased / unavailable; dropped from the season list. */
  available?: boolean;
}

/** One resolved playable source (AIOStreams pre-ranks; we never re-sort). */
export interface StremioStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  behaviorHints?: {
    bingeGroup?: string;
    videoSize?: number;
    filename?: string;
  };
  /** AIOStreams extension: structured stream facts, independent of the
   * user's formatter text. The server includes it when the client's
   * User-Agent carries an `AIOStreams/` token (see fetchStreams) or the
   * instance config forces it. `service.cached` is the authoritative
   * debrid cache flag — the formatter's ⚡ is only a fallback. */
  streamData?: {
    type?: string;
    service?: { id?: string; cached?: boolean };
  };
}

export interface CatalogResponse {
  metas?: MetaPreview[];
}
export interface MetaResponse {
  meta?: MetaDetail;
}
export interface StreamResponse {
  streams?: StremioStream[];
}

/** Stremio addons send ACAO:* by spec — safe to retry a Rust-side 403
 * from the webview (real Chrome fingerprint; see httpGetJson). */
const BROWSER_RETRY = { browserRetryOn403: true };

/** Base path for an addon: the manifest URL minus `/manifest.json`. */
export function addonBase(manifestUrl: string): string {
  return manifestUrl
    .trim()
    .replace(/\/manifest\.json$/i, "")
    .replace(/\/+$/, "");
}

/** Encode a path segment WITHOUT escaping the `:` in ids like `tt123:1:2` —
 * Stremio episode ids keep their colons in the path. Load-bearing; ported
 * verbatim from the old build. */
export function encSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/%3A/gi, ":");
}

export function fetchManifest(manifestUrl: string): Promise<AddonManifest> {
  return httpGetJson<AddonManifest>(
    `${addonBase(manifestUrl)}/manifest.json`,
    undefined,
    BROWSER_RETRY,
  );
}

/** A catalog page. `extra` is the raw Stremio extra segment when present —
 * e.g. `"skip=100"` or `"genre=Action"` — appended as its own path segment. */
export function fetchCatalog(
  manifestUrl: string,
  type: string,
  id: string,
  extra?: string,
): Promise<CatalogResponse> {
  const tail = extra ? `/${extra}` : "";
  return httpGetJson<CatalogResponse>(
    `${addonBase(manifestUrl)}/catalog/${encSegment(type)}/${encSegment(id)}${tail}.json`,
    undefined,
    BROWSER_RETRY,
  );
}

export function fetchMeta(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<MetaResponse> {
  return httpGetJson<MetaResponse>(
    `${addonBase(manifestUrl)}/meta/${encSegment(type)}/${encSegment(id)}.json`,
    undefined,
    BROWSER_RETRY,
  );
}

/** AIOStreams gates its structured `streamData` on the request UA containing
 * "AIOStreams/" (its own frontend's marker; server code: stream.ts route,
 * `req.headers['user-agent']?.includes('AIOStreams/')`). Appending the token
 * to the normal Chrome UA keeps the browser-shaped string WAF-safe while
 * opting into the richer response. Rust-side, per-request headers replace
 * same-named client defaults, so only this call presents the token. */
const STREAMS_UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 AIOStreams/compat",
};

/** Resolve playable sources for a title (`tt123`) or episode (`tt123:1:2`). */
export function fetchStreams(
  manifestUrl: string,
  type: string,
  id: string,
): Promise<StreamResponse> {
  return httpGetJson<StreamResponse>(
    `${addonBase(manifestUrl)}/stream/${encSegment(type)}/${encSegment(id)}.json`,
    STREAMS_UA,
    BROWSER_RETRY,
  );
}

/** Stremio types can be "series" or "anime.series" etc. */
export function isSeriesType(type?: string): boolean {
  return (type ?? "").includes("series");
}
