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

/** Said when the way to AIOStreams changes (conn.ts): the manifest URL saved
 * or cleared here, a sign-in recorded or ended (aiojf/account.ts). Settings'
 * AIOStreams tab re-reads its field, and Stream, Discover and the hero picker
 * load again. Jellyfin's twin is JF_CHANGED. */
export const AIO_CONN_CHANGED = "blammytv:aio-conn-changed";

/**
 * Store the manifest URL, or remove it with an empty one. It signs out of
 * nothing: since plan 024 the sign-in is its own connection and wins over any
 * manifest (conn.ts), and the manifest goes once there is a sign-in
 * (store.ts `noteSignIn`), which must not sign anyone out. Plan 023 tied the
 * sync token to this URL; Disconnect is how you sign out now.
 */
export function saveAioUrl(url: string): void {
  const next = url.trim();
  const prev = loadAioUrl();
  save(KEY, VERSION, next);
  if (next === prev) return;
  window.dispatchEvent(new Event(AIO_CONN_CHANGED));
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
