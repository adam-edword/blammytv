/**
 * How Record goes about it (plan 029, D3).
 *
 * A recording is a connection of its own. A line that allows one connection
 * has none to spare for the channel being watched, so there Record reads the
 * player's own buffer instead of opening a second stream (which the panel
 * would refuse, or answer by dropping the picture). Only the channel the
 * player is showing has a buffer to read.
 *
 * - "stream": a connection of its own. The default, and the answer for any
 *   line that reports no limit (Stalker, M3U, a panel that does not say) or
 *   allows more than one.
 * - "ask": the line allows one and this is the channel on screen, so the
 *   buffer is the way. Says what that means first, unless `warn` is off
 *   (Settings → Playback, or "Don't Show Again").
 * - "buffer": the same, with the warning turned off.
 */
export type RecordWay = "stream" | "buffer" | "ask";

export function recordWay(
  line: { max: number } | null | undefined,
  onScreen: boolean,
  warn: boolean,
): RecordWay {
  if (!onScreen || !line || line.max !== 1) return "stream";
  return warn ? "ask" : "buffer";
}
