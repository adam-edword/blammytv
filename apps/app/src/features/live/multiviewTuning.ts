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
 * - "smooth" is the library's own buffering and nothing else: no jumping
 *   and, since v0.9.104, no catching up either. Default.
 *
 * THE CATCH-UP WENT, on two measurements from Adam's line. mpegts.js can
 * play at 1.1x whenever the buffer ahead passes a threshold, and his
 * streams keep a large, bursty cushion on their own:
 * - v0.9.102, threshold 5s, 3 tiles for 20s: averages of 8.4, 7.0 and 6.3s
 *   ahead, so Cartoon Network played 10% fast for the whole window, and the
 *   one stall (0.6s) came on a tile that had been speeding up. He still saw
 *   a stutter every 20 to 30 seconds.
 * - v0.9.103, threshold 12s, 60s: "feels good", 0 hitches, 0 stalls, 3 of
 *   3757 frames dropped. But the cushion peaked at 14s, and the rate still
 *   flipped between 1 and 1.1 eleven times in the minute.
 * It only exists to win back time lost to stalls, there were none, and any
 * threshold is a guess at the next stream's bursts. Without it a tile falls
 * behind live by exactly the time it has stalled, which is how the main
 * player (mpv) behaves.
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

/**
 * What a tile keeps of what it has already played (plan 018, P2). A tile
 * can't seek, so behind the playhead is only memory: mpegts.js's live
 * default trims at 180s back to 120s, and hls.js keeps all of it, about 75
 * to 150MB a tile. 30s, trimmed to 20, is room for the browser's own small
 * steps back and nothing more.
 */
export const BACK_BUFFER_S = 30;
const BACK_BUFFER_KEEP_S = 20;

/** mpegts.js's config for a profile. Either way the back buffer is capped. */
export function mpegtsConfig(p: MvProfile): Record<string, unknown> {
  const cleanup = {
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: BACK_BUFFER_S,
    autoCleanupMinBackwardDuration: BACK_BUFFER_KEEP_S,
  };
  return p === "chase"
    ? { enableStashBuffer: false, liveBufferLatencyChasing: true, ...cleanup }
    : cleanup;
}

/** hls.js's config for a tile. */
export function hlsConfig(): Record<string, unknown> {
  return { enableWorker: true, lowLatencyMode: false, backBufferLength: BACK_BUFFER_S };
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
