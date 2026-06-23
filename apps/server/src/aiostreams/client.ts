import type {
  AddonManifest,
  CatalogResponse,
  MetaResponse,
  StreamResponse,
} from "./types.js";

/**
 * Thin client for a Stremio-compatible addon — we point it at the user's
 * AIOStreams instance.
 *
 * The manifest URL embeds the user's private config (debrid keys etc.), so it's
 * treated as a secret: it lives server-side and is kept out of error messages
 * and logs (see `safe()`).
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
    return this.getJson<AddonManifest>(`${this.base}/manifest.json`);
  }

  /**
   * A catalog page. `extra` is the raw Stremio extra segment when present —
   * e.g. `"skip=100"` or `"genre=Action"` — appended as its own path segment.
   */
  catalog(type: string, id: string, extra?: string): Promise<CatalogResponse> {
    const tail = extra ? `/${extra}` : "";
    return this.getJson<CatalogResponse>(
      `${this.base}/catalog/${enc(type)}/${enc(id)}${tail}.json`,
    );
  }

  meta(type: string, id: string): Promise<MetaResponse> {
    return this.getJson<MetaResponse>(
      `${this.base}/meta/${enc(type)}/${enc(id)}.json`,
    );
  }

  /** Resolve playable sources for a title (`tt123`) or episode (`tt123:1:2`). */
  stream(type: string, id: string): Promise<StreamResponse> {
    return this.getJson<StreamResponse>(
      `${this.base}/stream/${enc(type)}/${enc(id)}.json`,
    );
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`AIOStreams ${res.status} for ${this.safe(url)}`);
    return res.json() as Promise<T>;
  }

  /** Strip the secret config path from a URL so it's safe to log. */
  private safe(url: string): string {
    return url.startsWith(this.base)
      ? `<aiostreams>${url.slice(this.base.length)}`
      : "<aiostreams>";
  }
}

/** Encode a path segment without escaping the `:` in ids like `tt123:1:2`. */
function enc(seg: string): string {
  return encodeURIComponent(seg).replace(/%3A/gi, ":");
}
