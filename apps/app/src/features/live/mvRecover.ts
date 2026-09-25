import type { Failure } from "./mvTile";

/**
 * How a multi-view tile gets itself back (plan 018, H1).
 *
 * A tile that was playing and loses its stream reconnects on its own, up
 * to a budget, rather than sitting on a frozen frame until someone clicks
 * Retry. What a tile does on its FIRST connection is unchanged: a channel
 * that won't start (off the air, refused, a codec) says so at once, since
 * trying the same thing again right away rarely changes that.
 *
 * Pure, so the rules are tested without a stream; the tile and the tab
 * hold the clocks and the state.
 */

/** Reconnects before the tile gives up and shows why, with Retry. */
export const MAX_TRIES = 3;
/** A minute of picture refills the budget: a stream that drops once an
 * hour is not one that is failing. */
export const HEALTHY_MS = 60_000;
/** No new frame for this long, while it can be seen, is a freeze. The
 * theater's watchdog gives a stream 10 seconds; a tile's stalls are
 * already shown as Buffering from the first second. */
export const FROZEN_MS = 12_000;
/** How long a reconnect waits for the line to show a free slot. A panel
 * takes up to about 20 seconds to notice a stream has gone (connections.ts),
 * and is asked every few seconds while a tile waits. */
export const ROOM_WAIT_MS = 45_000;
/** Reconnects are spaced this far apart, so tiles that fail together (the
 * network, the PC waking) don't all ask the provider at once. */
export const STAGGER_MS = 1_500;

/** Whether a failure is one to reconnect from: the tile had been playing,
 * and a retry could help (a codec won't change). */
export function mayReconnect(f: Failure, played: boolean): boolean {
  return played && f.retry;
}

/**
 * The budget, at the moment a stream is lost: the tries used so far, reset
 * when the tile had been playing for HEALTHY_MS, and whether one is left.
 * `playingSince` is when the last first frame came, or null if none has
 * since the last loss.
 */
export function spend(
  tries: number,
  playingSince: number | null,
  now: number,
): { tries: number; give: boolean } {
  const used = playingSince !== null && now - playingSince >= HEALTHY_MS ? 0 : tries;
  if (used >= MAX_TRIES) return { tries: used, give: false };
  return { tries: used + 1, give: true };
}

/**
 * The freeze watch: decoded frames, sampled every couple of seconds.
 *
 * FRAMES, NOT currentTime OR THE BUFFER: a stuck decoder with bytes still
 * arriving keeps the buffer growing, and audio keeps the clock moving. And
 * not `waiting`, which comes only once the 6 to 14 second cushion is gone.
 *
 * ARMED BY A REAL FRAME: until frames have actually moved, nothing counts.
 * A tile that never decodes (a harness, a stream that never starts) is the
 * first connection's business, not this.
 *
 * NOT WHILE HIDDEN OR PAUSED: Chromium stops decoding video it can't show,
 * and a tile that can't be seen must not be torn down for it.
 */
export interface Watch {
  frames: number;
  /** When frames last moved (or the watch last couldn't look). */
  at: number;
  armed: boolean;
}

export const newWatch = (now: number): Watch => ({ frames: -1, at: now, armed: false });

export function watchStep(
  w: Watch,
  frames: number,
  now: number,
  looking: boolean,
): { w: Watch; frozen: boolean } {
  if (!looking) return { w: { ...w, at: now }, frozen: false };
  if (frames > w.frames) {
    return { w: { frames, at: now, armed: w.armed || (w.frames >= 0 && frames > 0) }, frozen: false };
  }
  return { w, frozen: w.armed && now - w.at >= FROZEN_MS };
}

/** Whether the line has a slot for a reconnect: no count to go by (an M3U,
 * a portal, several lines), or fewer in use than it allows. */
export function hasRoom(line: { max: number; active: number } | null): boolean {
  return !line || line.active < line.max;
}

/** When the next reconnect may go, given when the last one did: the wait,
 * and the new last. */
export function nextSlot(last: number, now: number): { wait: number; at: number } {
  const at = Math.max(now, last + STAGGER_MS);
  return { wait: at - now, at };
}

/** What the gate works with: the tab's, or a test's. */
export interface GateDeps {
  /** Whether the line has a slot now (hasRoom on the latest count). */
  room: () => boolean;
  /** A tile has started, or stopped, waiting on the count. */
  waiting: (on: boolean) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** When the last reconnect went, shared by every tile of the tab. */
  turn: { last: number };
  /** Have the stream's link looked up afresh. */
  fresh: () => void;
}

/**
 * THE GATE a tile passes before it connects again.
 *
 * A FREE SLOT FIRST. The stream a tile just lost still counts on the panel
 * for up to about 20 seconds, so on a full line a reconnect before then is
 * refused by the tile's own ghost. Rather than guess at the timing, it
 * waits until the count shows room, up to ROOM_WAIT_MS: the line is never
 * asked for more than it allows, so whether a panel would refuse the extra
 * stream or drop the oldest never comes up.
 *
 * THEN ITS TURN: tiles that fail together go STAGGER_MS apart. THEN A FRESH
 * LINK: a portal's links expire (the "never cache it" rule at
 * stalker.ts:417), and the one a tile played from an hour ago is a 403.
 */
export async function passGate(d: GateDeps): Promise<void> {
  const started = d.now();
  if (!d.room()) {
    d.waiting(true);
    try {
      while (!d.room() && d.now() - started < ROOM_WAIT_MS) await d.sleep(1000);
    } finally {
      d.waiting(false);
    }
  }
  const slot = nextSlot(d.turn.last, d.now());
  d.turn.last = slot.at;
  if (slot.wait > 0) await d.sleep(slot.wait);
  d.fresh();
}
