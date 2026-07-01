import { load, save } from "../../lib/storage";
import { isHttpUrl } from "./playlists";

/** The AIOStreams manifest URL — the single credential that powers the
 * Stream tab (it embeds the user's addon config, so treat it like a secret:
 * on-device only, never logged). */

const KEY = "aiostreams";
const VERSION = 1;

export function loadAioUrl(): string {
  return load<string>(KEY, VERSION, "");
}

export function saveAioUrl(url: string): void {
  save(KEY, VERSION, url.trim());
}

export function isValidManifestUrl(url: string): boolean {
  return isHttpUrl(url);
}

/* Hero-slider sources. We store the catalogs the user switched OFF, so
 * anything new in the manifest defaults to on. */

const EXCLUDED_KEY = "heroExcluded";

export function loadHeroExcluded(): string[] {
  return load<string[]>(EXCLUDED_KEY, VERSION, []);
}

export function saveHeroExcluded(keys: string[]): void {
  save(EXCLUDED_KEY, VERSION, keys);
}

/** Flip one catalog key's membership in the excluded list. */
export function toggleExcluded(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}
