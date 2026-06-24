import { httpGetJson } from "../http";
import type {
  AddonManifest,
  CatalogResponse,
  MetaResponse,
  StreamResponse,
} from "./types";

/**
 * Thin client for a Stremio-compatible addon (the user's AIOStreams instance).
 * Fetches go through Rust (`http_get`) so the webview isn't blocked by CORS.
 */
export class AddonClient {
  /** Base path, with the trailing `/manifest.json` stripped. */
  private readonly base: string;

  constructor(manifestUrl: string) {
    this.base = manifestUrl
      .trim()
      .replace(/\/manifest\.json$/i, "")
      .replace(/\/+$/, "");
  }

  manifest(): Promise<AddonManifest> {
    return httpGetJson<AddonManifest>(`${this.base}/manifest.json`);
  }

  /** A catalog page. `extra` is the raw Stremio extra segment when present —
   * e.g. `"skip=100"` or `"genre=Action"` — appended as its own path segment. */
  catalog(type: string, id: string, extra?: string): Promise<CatalogResponse> {
    const tail = extra ? `/${extra}` : "";
    return httpGetJson<CatalogResponse>(
      `${this.base}/catalog/${enc(type)}/${enc(id)}${tail}.json`,
    );
  }

  meta(type: string, id: string): Promise<MetaResponse> {
    return httpGetJson<MetaResponse>(
      `${this.base}/meta/${enc(type)}/${enc(id)}.json`,
    );
  }

  /** Resolve playable sources for a title (`tt123`) or episode (`tt123:1:2`). */
  stream(type: string, id: string): Promise<StreamResponse> {
    return httpGetJson<StreamResponse>(
      `${this.base}/stream/${enc(type)}/${enc(id)}.json`,
    );
  }
}

/** Encode a path segment without escaping the `:` in ids like `tt123:1:2`. */
function enc(seg: string): string {
  return encodeURIComponent(seg).replace(/%3A/gi, ":");
}
