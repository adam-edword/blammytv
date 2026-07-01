import { httpGetJson } from "../lib/http";

/**
 * AIOStreams (a Stremio addon) — catalog listing straight from the manifest.
 * The manifest is public JSON at the user's manifest URL; its `catalogs`
 * array is what feeds the Stream tab's hero slider.
 */

export interface AioCatalog {
  /** Unique across the manifest: `${type}/${id}`. */
  key: string;
  type: string;
  name: string;
}

interface AioManifest {
  catalogs?: Array<{ type?: string; id?: string; name?: string }>;
}

/** Pure mapping, separated from the fetch for testability. */
export function catalogsFromManifest(manifest: AioManifest): AioCatalog[] {
  return (manifest.catalogs ?? [])
    .filter((c) => c.id && c.type)
    .map((c) => ({
      key: `${c.type}/${c.id}`,
      type: c.type!,
      name: c.name || c.id!,
    }));
}

export async function fetchAioCatalogs(
  manifestUrl: string,
): Promise<AioCatalog[]> {
  return catalogsFromManifest(await httpGetJson<AioManifest>(manifestUrl.trim()));
}
