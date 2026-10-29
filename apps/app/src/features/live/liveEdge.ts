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

/**
 * Whether the buffer's end can be trusted to BE live, for Go Live.
 *
 * Go Live used to reload the stream, because the buffer behind a paused player
 * stopped growing once its forward half was full (a few minutes), so the end of
 * it was nowhere near now. Live channels sit on a disk cache now (mpvcache.rs),
 * where reading goes on while paused and the end of the buffer is the live edge.
 * Then Go Live is a seek, and the stream is not touched. The reload stays for a
 * reader that stopped, a dead socket having nothing to seek to.
 *
 * "Stopped" is read from the one number the poll already has, the end of the
 * seekable range. The provider's clock is the wall clock, so the end advances
 * one second a second, and `end - now` is flat while reading keeps up. It falls
 * when reading does not. The test is that figure against the best it has been:
 * a bigger fall than STALL_SECS, once, and the stream is stalled until it is
 * reloaded. Sticky on purpose: a stall that recovered by reconnecting may have
 * left a hole, and a reload is the way back to a buffer that is known whole.
 */
export const STALL_SECS = 20;

/** The best `end - now` seen on this stream, and whether it has since fallen
 * short of that by more than STALL_SECS. */
export interface ReadWatch {
  peak: number;
  stalled: boolean;
}

/**
 * The watch after this reading. `end` is the seekable range's end in stream
 * seconds, `now` is performance.now() in ms. Null `end` (nothing known) changes
 * nothing. Start a stream with null.
 *
 * The peak is the best so far rather than the first reading, because the buffer
 * fills faster than real time for its first seconds and a first reading would
 * bank that as slack.
 *
 * STALL_SECS is wide because a stream of HLS segments lands its end in steps of
 * a segment, ten seconds or so, and that is not a stall. A false stall costs a
 * reload, which is what Go Live was before. A missed one costs a seek into a
 * buffer that is a little old.
 */
export function nextReadWatch(
  cur: ReadWatch | null,
  o: { end: number | null | undefined; now: number },
): ReadWatch | null {
  if (o.end == null) return cur;
  const lead = o.end - o.now / 1000;
  if (!cur) return { peak: lead, stalled: false };
  const peak = Math.max(cur.peak, lead);
  return { peak, stalled: cur.stalled || peak - lead > STALL_SECS };
}

/** What Go Live does: seek to a second, or reload the stream. */
export type GoLive = { kind: "seek"; to: number } | { kind: "reload" };

/**
 * Seek to the live edge when the buffer reaches it, reload when it may not.
 * `edge` is the DVR window's end (dvr.ts), null until the edge baseline has
 * settled, and a press before then reloads as it always did. A player that is
 * buffering now has nothing at the end of its buffer to land on.
 */
export function goLiveAction(o: {
  watch: ReadWatch | null;
  edge: number | null | undefined;
  buffering: boolean;
}): GoLive {
  if (o.edge == null || o.watch == null || o.watch.stalled || o.buffering) {
    return { kind: "reload" };
  }
  return { kind: "seek", to: o.edge };
}
