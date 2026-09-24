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
 *   1.1x instead of jumping. Default. Measured on Adam's line (v0.9.102,
 *   3 tiles, 20s): 0 jumps, 0 frames dropped, one 0.6s stall, ~60fps.
 *
 * WHEN it catches up comes from the same run. His streams sit 6 to 8s
 * ahead of the playhead on their own (averages 8.4, 7.0 and 6.3s). v0.9.102
 * sped up past 5s, so Cartoon Network played at 1.1x for the whole 20s,
 * and the one stall came on a tile that had been speeding up. Now it speeds up
 * only past 12s, which is drift (stalls adding up), not the stream's normal
 * cushion, and settles back at 8s.
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
        liveSyncMaxLatency: 12,
        liveSyncTargetLatency: 8,
        liveSyncPlaybackRate: 1.1,
      };
}

/**
 * Where playback visibly hitched, from the times frames were presented
 * (requestVideoFrameCallback's `now`, in ms). A hitch is a gap over 100ms
 * AND over three times the median gap, so a 30fps stream's normal 33ms is
 * never one and neither is a single late frame at 60fps. `at` is when the
 * frame before the gap was shown.
 */
export function findHitches(frameTimes: number[]): { at: number; gap: number }[] {
  const gaps = frameTimes.slice(1).map((ft, i) => ft - frameTimes[i]);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  const out: { at: number; gap: number }[] = [];
  gaps.forEach((g, i) => {
    if (g > 100 && g > typical * 3) out.push({ at: frameTimes[i], gap: g });
  });
  return out;
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
