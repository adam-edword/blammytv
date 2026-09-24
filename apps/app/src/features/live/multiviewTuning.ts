/**
 * How a multi-view tile buffers a live stream, and the registry the stutter
 * probe reads (`btvMultiviewStats` in probe.ts).
 *
 * TWO PROFILES, because Adam's first tiles through the proxy (v0.9.101)
 * played "SUPER stuttery. like genuinely unwatchable", and the settings they
 * ran under are the suspect, not yet the proven cause:
 *
 * - "chase" is v0.9.101 exactly. mpegts.js's seek-based latency chaser,
 *   which its own source calls "not recommended": once more than 1.5s is
 *   buffered it jumps playback to 0.5s from the newest frame, throwing the
 *   rest away. IPTV arrives in bursts, so that is a skip on every burst and
 *   a stall whenever the next one is late. The stash buffer was off too.
 * - "smooth" is the library's own buffering, and catches up by playing at
 *   1.1x when more than 5s has piled up, instead of jumping. Default.
 *
 * `btvMultiviewTune("chase")` switches every playing tile back, so one
 * sitting can measure both with `btvMultiviewStats()`.
 */

export type MvProfile = "smooth" | "chase";

const EVENT = "blammytv:mv-profile";
let profile: MvProfile = "smooth";

export const getMvProfile = (): MvProfile => profile;

export function setMvProfile(p: MvProfile): void {
  if (p === profile) return;
  profile = p;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onMvProfileChange(cb: (p: MvProfile) => void): () => void {
  const h = () => cb(profile);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** mpegts.js's config for a profile. */
export function mpegtsConfig(p: MvProfile): Record<string, unknown> {
  return p === "chase"
    ? { enableStashBuffer: false, liveBufferLatencyChasing: true }
    : {
        liveSync: true,
        liveSyncMaxLatency: 5,
        liveSyncTargetLatency: 3,
        liveSyncPlaybackRate: 1.1,
      };
}

/* ------------------------------------------------------------- registry */

/** A tile that is playing, as the stutter probe needs it. */
export interface LiveTile {
  name: string;
  video: HTMLVideoElement;
  /** mpegts.js's download speed in KB/s, when the tile is mpegts. */
  speed(): number | undefined;
}

const tiles = new Set<LiveTile>();

/** Register a playing tile; the returned function unregisters it. */
export function registerTile(t: LiveTile): () => void {
  tiles.add(t);
  return () => {
    tiles.delete(t);
  };
}

export const liveTiles = (): LiveTile[] => [...tiles];
