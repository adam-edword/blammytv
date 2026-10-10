import { load, save } from "../../lib/storage";

/**
 * A channel's guide, matched by hand (Guide → right-click → Fix guide…).
 *
 * The app matches a channel to the guide by the id the provider gave it, and
 * a provider that gives a wrong one, or none, leaves the channel on "No
 * Information" with the right listings sitting in the download. A fix says
 * which of the guide's own channels this one should use instead: per
 * playlist, our channel id → the guide's channel id.
 *
 * The index honours it (source.ts, through `applyGuideFixes`), so a fix
 * reaches the screen the way any other guide change does: a forced refresh
 * downloads the guide and parses it with the fix in the index.
 */

const KEY = "guideFixes";
const VERSION = 1;

type Fixes = Record<string, Record<string, string>>;

/** Every saved fix. A damaged store, or a damaged entry in it, reads as no
 * fixes rather than throwing: this is read on the way into a guide load. */
function loadAll(): Fixes {
  const raw = load<unknown>(KEY, VERSION, {});
  const out: Fixes = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [playlistId, perChannel] of Object.entries(raw)) {
    if (typeof perChannel !== "object" || perChannel === null || Array.isArray(perChannel))
      continue;
    const kept: Record<string, string> = {};
    for (const [channelId, guideId] of Object.entries(perChannel))
      if (typeof guideId === "string" && guideId) kept[channelId] = guideId;
    if (Object.keys(kept).length) out[playlistId] = kept;
  }
  return out;
}

/** One playlist's fixes: our channel id → the guide's channel id. */
export function loadGuideFixes(playlistId: string): Record<string, string> {
  return loadAll()[playlistId] ?? {};
}

/** Save a fix, replacing the one this channel had. Returns the playlist's
 * fixes as they now stand. */
export function saveGuideFix(
  playlistId: string,
  channelId: string,
  guideId: string,
): Record<string, string> {
  const all = loadAll();
  const next = { ...all[playlistId], [channelId]: guideId };
  save(KEY, VERSION, { ...all, [playlistId]: next });
  return next;
}

/** Take a fix away: the channel goes back to the guide id its provider
 * gave it. Returns the playlist's fixes as they now stand. */
export function removeGuideFix(
  playlistId: string,
  channelId: string,
): Record<string, string> {
  const all = loadAll();
  const next = { ...all[playlistId] };
  delete next[channelId];
  if (Object.keys(next).length) all[playlistId] = next;
  else delete all[playlistId];
  save(KEY, VERSION, all);
  return next;
}

/** A playlist's fixes as one string, the same for the same fixes whatever
 * order they were saved in. "" for none, which is what a guide parsed before
 * fixes existed also reads as. */
export function fixKey(fixes: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(fixes).filter(([, g]) => !!g);
  if (pairs.length === 0) return "";
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(pairs);
}

/** Keep the fixes of these playlists and drop everyone else's. A deleted
 * playlist takes its fixes with it, as it takes its credentials and its
 * folder curation (settings/playlists.ts#savePlaylists). */
export function keepGuideFixesFor(playlistIds: Iterable<string>): void {
  const keep = new Set(playlistIds);
  const all = loadAll();
  const rest = Object.fromEntries(Object.entries(all).filter(([id]) => keep.has(id)));
  if (Object.keys(rest).length !== Object.keys(all).length) save(KEY, VERSION, rest);
}

/**
 * The guide index with the saved fixes applied. Both builders call this
 * (source.ts: Xtream's `epgIndex`, and the M3U builder), so a fix means the
 * same thing for either.
 *
 * A fixed channel leaves the list of the guide id it came with and joins the
 * list of the one it was given; the channels that shared its old id stay
 * where they were. `known` is every channel this build has, because a
 * channel with no guide id at all is in no list yet and is the commonest one
 * to fix. A fix for a channel that is not in this build (hidden since, or
 * gone from the provider) is ignored, and so is one with no guide id.
 *
 * Returns `index` itself when no fix applies; otherwise a new map, and the
 * input is left as it was.
 */
export function applyGuideFixes(
  index: Map<string, string[]>,
  fixes: Readonly<Record<string, string>>,
  known: ReadonlySet<string>,
): Map<string, string[]> {
  const moves = new Map<string, string>();
  for (const [channelId, guideId] of Object.entries(fixes))
    if (guideId && known.has(channelId)) moves.set(channelId, guideId);
  if (moves.size === 0) return index;

  const out = new Map<string, string[]>();
  for (const [guideId, ids] of index) {
    const stay = ids.filter((id) => !moves.has(id));
    if (stay.length) out.set(guideId, stay);
  }
  for (const [channelId, guideId] of moves) {
    const list = out.get(guideId);
    if (list) list.push(channelId);
    else out.set(guideId, [channelId]);
  }
  return out;
}
