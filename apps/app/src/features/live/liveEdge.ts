/**
 * How far behind the live edge we actually are, from mpv rather than from
 * dead reckoning.
 *
 * THE BUG THIS REPLACES. The live-edge indicator was pure client-side
 * guesswork: every seek walked it 0.8% per second of REQUESTED movement and
 * nothing ever asked mpv whether the seek happened. Press Back 10s at the
 * start of the buffer, which on live is wherever you tuned in, and mpv
 * refuses while the bar keeps marching left. It then stayed wrong until Jump
 * to live, telling you that you were behind when you were not, and offering
 * a "fix" that costs a full stream reload.
 *
 * WHY demuxer-cache-duration. mpv's `seekable-start`/`seekable-end` would
 * give the window directly, but they do not resolve as slash paths on the
 * shipped libmpv (checked on a real channel: both `<unset>`). What does
 * resolve is `demuxer-cache-duration`, buffered-but-unplayed seconds, and it
 * happens to answer the question exactly:
 *
 *   at the live edge   playback and demuxing advance together, so it sits at
 *                      whatever the provider pushes ahead and STAYS there
 *   seek back 10s      it grows by 10
 *   mpv refuses        it does not grow at all
 *
 * Measured on a live channel: 16.544 at the edge, 28.992 after seeking back,
 * against a cache-time that advanced 5.792 and a time-pos that went back
 * 6.656. 5.792 + 6.656 = 12.448, and 28.992 - 16.544 = 12.448 exactly. The
 * arithmetic holds because cache-duration IS cache-time minus time-pos.
 *
 * So the baseline is whatever it reads while we are known to be at the edge,
 * and everything above that baseline is genuinely behind live.
 */

/**
 * Percent of the indicator per second behind live. The pre-existing scale,
 * kept deliberately: 0.8%/sec means the bar empties at about two minutes
 * back, which is roughly the DVR window a live stream offers anyway.
 */
export const PCT_PER_SEC = 0.8;

/**
 * Ignore drift smaller than this, in seconds.
 *
 * The forward buffer is not perfectly flat even sitting still: the demuxer
 * runs ahead in bursts as segments land. Without a floor the indicator
 * would twitch off 100% while the viewer is plainly live and has touched
 * nothing.
 */
export const EDGE_TOL = 2;

/**
 * Behind-live seconds from a cache-duration reading and the baseline taken
 * at the edge. Null baseline (nothing established yet) reads as at-live,
 * which is the right assumption on a stream that has only just presented.
 */
export function behindLive(
  cacheDur: number | null | undefined,
  baseline: number | null,
): number {
  if (cacheDur == null || baseline == null) return 0;
  const behind = cacheDur - baseline;
  return behind <= EDGE_TOL ? 0 : behind;
}

/** Behind-live seconds to the indicator's 0..100. */
export function livePctFor(behindSec: number): number {
  return Math.min(100, Math.max(0, 100 - behindSec * PCT_PER_SEC));
}

/**
 * The edge baseline after this reading, or null if there still isn't one.
 *
 * Captured EXACTLY ONCE per stream, on the first reading after the picture
 * is up — the one moment we know we are at the live edge, because playback
 * has just started from wherever the provider handed us the stream.
 *
 * Two ways to get this wrong, both of which make the indicator lie without
 * touching `behindLive` at all:
 *
 *   capture while loading  the forward buffer is mid-fill, so the baseline
 *                          is too small and the rail reads permanently
 *                          behind on a stream nobody has touched
 *   re-capture later       "live" gets silently redefined as wherever the
 *                          user happens to be standing, so rewinding once
 *                          means the indicator can never read behind again
 *
 * A cacheDur of exactly 0 is a REAL baseline, not an absent one: a stream
 * that presents with an empty forward buffer reads 0.0 here, and treating
 * that as "not captured yet" would keep re-capturing forever.
 */
export function nextBaseline(
  cur: number | null,
  loading: boolean,
  cacheDur: number | null | undefined,
): number | null {
  if (cur != null) return cur;
  if (loading) return null;
  return cacheDur ?? null;
}
