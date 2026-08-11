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
 * How long after the first frame the baseline keeps refining.
 *
 * The forward buffer is NOT at its steady size when the picture first
 * appears — mpv is still filling it, and it climbs for several seconds. The
 * first version of this captured on that first frame and got a number far
 * too small, which put the live edge permanently ahead of the playhead: the
 * rail sat at about 95%, and Jump to live refilled the buffer and landed in
 * exactly the same place. Measured on a real channel, the gap settles well
 * inside this window.
 */
export const SETTLE_MS = 10_000;

/** The natural forward buffer, and whether we are still refining it. */
export interface EdgeBaseline {
  /** Steady-state seconds of buffered-but-unplayed content. */
  gap: number;
  /** Inside the settle window, with no seek yet. */
  settling: boolean;
}

/**
 * The edge baseline after this reading, or null if there still isn't one.
 *
 * Takes the MAXIMUM gap seen while settling rather than the first, because
 * the buffer only grows towards its steady size. It freezes on the first
 * seek: a seek back inflates the gap by exactly the amount seeked, and
 * absorbing that would redefine "live" as wherever the user is standing —
 * after which the indicator could never report being behind again.
 *
 * A gap of exactly 0 is a REAL reading, not an absent one.
 */
export function nextBaseline(
  cur: EdgeBaseline | null,
  o: {
    loading: boolean;
    cacheDur: number | null | undefined;
    /** ms since the picture appeared. */
    sincePresent: number;
    /** The user has seeked on this stream. */
    seeked: boolean;
  },
): EdgeBaseline | null {
  if (o.loading) return null;
  if (o.cacheDur == null) return cur;
  if (!cur) return { gap: o.cacheDur, settling: true };
  if (!cur.settling) return cur;
  if (o.seeked || o.sincePresent >= SETTLE_MS)
    return { gap: cur.gap, settling: false };
  return { gap: Math.max(cur.gap, o.cacheDur), settling: true };
}
