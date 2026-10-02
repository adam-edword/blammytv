import { isString, load, loadList, save } from "../../lib/storage";
import { isHttpUrl } from "./playlists";

/** The AIOStreams manifest URL — the single credential that powers the
 * Stream tab (it embeds the user's addon config, so treat it like a secret:
 * on-device only, never logged). */

const KEY = "aiostreams";
const VERSION = 1;

export function loadAioUrl(): string {
  const url = load<unknown>(KEY, VERSION, "");
  return typeof url === "string" ? url : "";
}

export function saveAioUrl(url: string): void {
  save(KEY, VERSION, url.trim());
}

export function isValidManifestUrl(url: string): boolean {
  return isHttpUrl(url);
}

/* Hero-slider sources: the catalogs the hero pulls from, as an explicit
 * selection. Empty means the default mix (everything browsable). */

const SOURCES_KEY = "heroSources";

export function loadHeroSources(): string[] {
  return loadList(SOURCES_KEY, VERSION, isString);
}

export function saveHeroSources(keys: string[]): void {
  save(SOURCES_KEY, VERSION, keys);
}
