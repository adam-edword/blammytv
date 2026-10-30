/**
 * How Record goes about it (plan 029, D3 and D5).
 *
 * A recording is a connection of its own. A line that allows one connection
 * has none to spare for the channel being watched, so there Record reads the
 * player's own buffer instead of opening a second stream (which the panel
 * would refuse, or answer by dropping the picture). Only the channel the
 * player is showing has a buffer to read.
 *
 * - "stream": a connection of its own, no dialog. The default, and what any
 *   other line gets once its heads-up is off.
 * - "notice": a connection of its own, after a heads-up that says so (D5).
 *   Every line but D3's case, until the heads-up's "Don't Show Again".
 * - "ask": the line allows one and this is the channel on screen, so the
 *   buffer is the way. Says what that means first, unless `warn` is off
 *   (Settings → Playback, or "Don't Show Again").
 * - "buffer": the same, with the warning turned off.
 *
 * D3 wins where it applies: its dialog is the only one, and with `warn` off
 * the heads-up does not stand in for it. `notice` defaults to off so a caller
 * that has no heads-up gets the D3 answers alone.
 */
export type RecordWay = "stream" | "notice" | "buffer" | "ask";

export function recordWay(
  line: { max: number } | null | undefined,
  onScreen: boolean,
  warn: boolean,
  notice = false,
): RecordWay {
  if (onScreen && line?.max === 1) return warn ? "ask" : "buffer";
  return notice ? "notice" : "stream";
}

/** What the heads-up says (D5). A line with a reading names its limit; one
 * without (M3U, Stalker, a panel that does not say) names the provider's. */
export function noticeText(line: { max: number } | null | undefined): string {
  const max = line?.max;
  if (!max || max < 1) return "This recording uses one of your provider’s streams for as long as it runs.";
  return max === 1
    ? "This recording uses the one stream your line allows, for as long as it runs."
    : `This recording uses one of the ${max} streams your line allows, for as long as it runs.`;
}
