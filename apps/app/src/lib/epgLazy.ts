import type { EpgProgram } from "@blammytv/shared";
import { loadPlaylists } from "./playlists";
import { XtreamClient } from "./xtream/client";
import { mapShortEpg } from "./xtream/mapper";

/**
 * Lazy, per-channel EPG. We never pull the whole-account XMLTV (tens of MB for
 * big providers — it pins the main thread). Instead the guide requests a
 * channel's `get_short_epg` (a few KB) as its row scrolls into view; results are
 * cached and pushed to subscribers so the lane fills in.
 *
 * The channel id encodes its source + stream id (`sourceId:c:streamId`), so a
 * fetch needs no extra wiring — it looks the playlist (credentials) up by id.
 */

const cache = new Map<string, EpgProgram[]>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
// Bumped on every cache change so `useSyncExternalStore` re-renders.
let version = 0;

export function subscribeEpg(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function epgVersion(): number {
  return version;
}

/** Cached programmes for a channel (undefined = never fetched). */
export function getChannelPrograms(channelId: string): EpgProgram[] | undefined {
  return cache.get(channelId);
}

/** Fetch a channel's EPG once (no-op if cached or already in flight). */
export function requestChannelEpg(channelId: string): void {
  if (cache.has(channelId) || inFlight.has(channelId)) return;
  inFlight.add(channelId);
  fetchChannelEpg(channelId)
    .then((programs) => {
      // Cache success (including a genuine empty result → "No Information").
      cache.set(channelId, programs);
      version++;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // Don't cache failures: a transient error (panel 5xx, network blip,
      // throttling during a scroll burst) must not pin the channel to "No
      // Information" for the session. Leaving it uncached lets it retry when the
      // row next scrolls into view or the hero/prefetch path requests it.
    })
    .finally(() => {
      inFlight.delete(channelId);
    });
}

async function fetchChannelEpg(channelId: string): Promise<EpgProgram[]> {
  const sep = channelId.indexOf(":c:");
  if (sep < 0) return [];
  const sourceId = channelId.slice(0, sep);
  const streamId = channelId.slice(sep + 3);

  const playlist = loadPlaylists().find((p) => p.id === sourceId);
  // Xtream is the only kind with a per-channel EPG API; M3U has only bulk XMLTV.
  if (!playlist || playlist.kind !== "xtream") return [];

  const { epg_listings = [] } = await new XtreamClient(playlist).getShortEpg(
    streamId,
  );
  return mapShortEpg(epg_listings, channelId);
}
