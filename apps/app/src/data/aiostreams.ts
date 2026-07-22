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

interface ManifestCatalog {
  type?: string;
  id?: string;
  name?: string;
  /** Stremio extras. A *required* `search` extra marks a search-results
   * catalog — it only answers queries, there's nothing to browse. */
  extra?: Array<{ name?: string; isRequired?: boolean }>;
  /** Legacy form of the same declaration. */
  extraRequired?: string[];
}

interface AioManifest {
  catalogs?: ManifestCatalog[];
}

function isSearchOnly(c: ManifestCatalog): boolean {
  return (
    (c.extra?.some((e) => e.name === "search" && e.isRequired) ?? false) ||
    (c.extraRequired?.includes("search") ?? false)
  );
}

/** Pure mapping, separated from the fetch for testability. Search-only
 * catalogs are omitted — they can't feed a browse row like the hero. */
export function catalogsFromManifest(manifest: AioManifest): AioCatalog[] {
  return (manifest.catalogs ?? [])
    .filter((c) => c.id && c.type && !isSearchOnly(c))
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
