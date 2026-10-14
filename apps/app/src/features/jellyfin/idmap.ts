/**
 * Which Jellyfin item a title's key names (plan 027).
 *
 * A `jf:<hex>` key carries its Jellyfin id. A `tt…` key does not: it is the
 * title's IMDb id, shared with every other source (ids.ts), and Jellyfin 12.2
 * has no lookup by IMDb id. So the page remembers what the lists it read
 * named: a library page, a search, a Resume row. It is looked up when a title
 * opens, and a Continue Watching card is opened long after the list that named
 * it, so it lives on disk.
 *
 * It belongs to the server it was read from (`base`): another sign-in starts it
 * empty, and `forgetJf` takes it with the rest. Oldest out past `CAP`. Only
 * titles are kept (films and shows): an episode's Jellyfin id is found by
 * reading its show's episodes, whose numbers are in the key.
 */

import { load, save } from "../../lib/storage";
import { HEX32 } from "./items";
import { jellyfinIdOfKey } from "./ids";

export const IDS_KEY = "jfIds";
const VERSION = 1;
const CAP = 2000;

interface Stored {
  base: string;
  /** `[titleKey, jellyfinId]`, oldest first. */
  pairs: [string, string][];
}

function read(base: string): Map<string, string> {
  const s = load<Stored | null>(IDS_KEY, VERSION, null);
  if (!s || s.base !== base || !Array.isArray(s.pairs)) return new Map();
  return new Map(
    s.pairs.filter(
      (p): p is [string, string] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string",
    ),
  );
}

/** The Jellyfin id for a title key, or null when none is known. */
export function jfIdFor(base: string, key: string): string | null {
  const own = jellyfinIdOfKey(key);
  if (own) return own;
  const id = read(base).get(key);
  return id && HEX32.test(id) ? id : null;
}

/** The key a Jellyfin id was read under, or null when none is known. Only
 * titles that have an IMDb key are here: a `jf:` key is its id, and says so. */
export function jfKeyFor(base: string, jellyfinId: string): string | null {
  for (const [key, id] of read(base)) if (id === jellyfinId) return key;
  return null;
}

/** Remember what a list named. Each entry is `[titleKey, jellyfinId]`. A `jf:`
 * key needs no entry. */
export function rememberJfIds(base: string, entries: Iterable<readonly [string, string]>): void {
  let map: Map<string, string> | null = null;
  let changed = false;
  for (const [key, id] of entries) {
    if (!HEX32.test(id) || jellyfinIdOfKey(key)) continue;
    map ??= read(base);
    if (map.get(key) === id) continue;
    // Delete first so a changed or repeated key moves to the newest end.
    map.delete(key);
    map.set(key, id);
    changed = true;
  }
  if (!map || !changed) return;
  save<Stored>(IDS_KEY, VERSION, { base, pairs: [...map].slice(-CAP) });
}
