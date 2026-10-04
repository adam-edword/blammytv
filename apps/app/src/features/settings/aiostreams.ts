import { isString, load, loadList, save } from "../../lib/storage";
import { signOutOfAio } from "../aiojf/account";
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

/** Said when the stored URL changes, for the screens that depend on there
 * being one (Settings' AIOStreams sync row). */
export const AIO_URL_CHANGED = "blammytv:aio-url-changed";

export function saveAioUrl(url: string): void {
  const next = url.trim();
  const prev = loadAioUrl();
  save(KEY, VERSION, next);
  if (next === prev) return;
  // AIOStreams' sync token belongs to the config this URL names (plan 023):
  // another URL, or none, is another account. Nothing to sign out of before
  // the first URL.
  if (prev) void signOutOfAio();
  window.dispatchEvent(new Event(AIO_URL_CHANGED));
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
