import type { MpvStats } from "../../lib/tauri";

/** A channel count by the name a person knows it by: 6 is "5.1". */
const LAYOUTS: Record<number, string> = { 1: "mono", 2: "stereo", 6: "5.1", 8: "7.1" };
const layoutOf = (n: number) => LAYOUTS[n] ?? `${n} ch`;

/**
 * The stats overlay's Channels row: the source, then what reached the
 * device. "5.1 → 5.1" is surround playing as surround, "5.1 → stereo" a
 * downmix (headphones, or a device Windows has set to stereo). Either half
 * alone when mpv reports only one.
 */
export function channels(s: Pick<MpvStats, "audioChannels" | "audioOut">): string | null {
  const from = s.audioChannels ? layoutOf(s.audioChannels) : null;
  const to = s.audioOut || null;
  if (from && to) return `${from} → ${to}`;
  return from ?? to;
}
