/**
 * The Jellyfin ids Stream cannot compute (plan 024).
 *
 * Every title keeps its Stremio id here, and for most of them AIOStreams'
 * Jellyfin id follows from it (ids.ts `jellyfinIdOf`). Two kinds do not: a
 * title from an addon's own id scheme, which AIOStreams hashes (`b2…`, its
 * Stremio id only in the item's `Path`), and a Kitsu-style episode, whose
 * packed id carries a season that its Stremio id (`kitsu:N:E`) does not.
 * Those are read off the lists they arrive in (a catalog page, a show's
 * episodes), remembered here, and looked up before anything is computed.
 *
 * Only an id the computation gets wrong is stored, so the map stays small.
 * It belongs to the instance it was read from (`base`): another sign-in
 * starts it empty. Kept on disk, oldest out past `CAP`, since a Continue
 * Watching card is opened long after the list that named it.
 */

import { load, save } from "../../lib/storage";
import { jellyfinIdOf } from "./ids";

const KEY = "aiojfIds";
const VERSION = 1;
const CAP = 1500;

interface Stored {
  base: string;
  /** Oldest first. */
  pairs: [string, string][];
}

const HEX32 = /^[0-9a-f]{32}$/;

function read(base: string): Map<string, string> {
  const s = load<Stored | null>(KEY, VERSION, null);
  if (!s || s.base !== base || !Array.isArray(s.pairs)) return new Map();
  return new Map(s.pairs.filter((p) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string"));
}

/**
 * The Jellyfin id for a Stremio id, or null when there is none to be had.
 * `kind` is the type the title is held under (`movie` or `series`). An
 * `aiojf:<hex>` id is an episode AIOStreams hashed, whose own hex is its id;
 * the map comes next, then the computation.
 */
export function jellyfinIdFor(base: string, kind: string, id: string): string | null {
  if (id.startsWith("aiojf:")) {
    const hex = id.slice("aiojf:".length).toLowerCase();
    return HEX32.test(hex) ? hex : null;
  }
  return read(base).get(id) ?? jellyfinIdOf(id, kind);
}

/**
 * Remember what a list named. Each entry is `[stremioId, kind, jellyfinId]`;
 * an id the computation already gets right is not stored.
 */
export function rememberIds(base: string, entries: Iterable<readonly [string, string, string]>): void {
  let map: Map<string, string> | null = null;
  let changed = false;
  for (const [id, kind, jid] of entries) {
    if (!HEX32.test(jid) || id.startsWith("aiojf:")) continue;
    if (jellyfinIdOf(id, kind) === jid) continue;
    map ??= read(base);
    if (map.get(id) === jid) continue;
    // Delete first so a changed or repeated id moves to the newest end.
    map.delete(id);
    map.set(id, jid);
    changed = true;
  }
  if (!map || !changed) return;
  const pairs = [...map].slice(-CAP);
  save<Stored>(KEY, VERSION, { base, pairs });
}
