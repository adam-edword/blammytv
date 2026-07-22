import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = path.join(__dirname, "..", "catalog.json");

/**
 * Loads catalog.json (product<->theme mapping + theme metadata) and
 * derives fast lookup structures. This IS the allowlist: theme ids from
 * catalog.json are the only ids /payload/:themeId will ever resolve to a
 * file path with, and priceId->entitlement mapping is how the webhook
 * turns a Checkout session into a key.
 */
export function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  const raw = readFileSync(catalogPath, "utf8");
  const parsed = JSON.parse(raw);
  return buildCatalog(parsed);
}

export function buildCatalog({ passPriceIds = [], themes = [] }) {
  const themesById = new Map(themes.map((t) => [t.id, t]));
  const priceIdToThemeId = new Map();
  for (const theme of themes) {
    for (const priceId of theme.priceIds ?? []) {
      priceIdToThemeId.set(priceId, theme.id);
    }
  }
  const passPriceIdSet = new Set(passPriceIds);

  return {
    passPriceIds,
    themes,
    themesById,
    /** All theme metadata objects, catalog order. Used for pass entitlement. */
    allThemeIds: themes.map((t) => t.id),
    isPassPriceId: (priceId) => passPriceIdSet.has(priceId),
    themeIdForPriceId: (priceId) => priceIdToThemeId.get(priceId) ?? null,
    getTheme: (id) => themesById.get(id) ?? null,
  };
}
