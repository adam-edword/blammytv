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
