/**
 * "The player couldn't start", for the tune card (v0.11.35).
 *
 * InvertedPlayer asks native to open the player (inv_open). That call can
 * fail for a reason of the PLAYER and not the stream: libmpv-2.dll will not
 * load (it imports vulkan-1.dll, and a PC with no Vulkan loader cannot load
 * it), mpv_create or mpv_initialize fails, the video window cannot be made.
 * Native builds an exact message for each. It used to die in a console.error,
 * and with no player every property reads empty, so nothing could tell it
 * from a slow stream: the tune watchdog ended it 10 or 40 seconds later with
 * "It's the stream, not you", the opposite of the truth.
 *
 * Now InvertedPlayer reports the failed open here, the moment it happens, and
 * the tune card says so (TheaterOverlay).
 *
 * Module state and not the overlay api: InvertedPlayer has no hold of the
 * host's api object, and there is one player at a time (the three hosts share
 * one mpv instance and one #player-slot). The report is taken back when that
 * player is torn down or opened on another url, which is when the card it
 * belongs to goes too.
 */

/** The card's first line. */
export const PLAYER_FAULT_LINE = "The player couldn’t start.";

export interface PlayerFault {
  /** What native said, shortened (playerFaultWhy). Empty when it said nothing. */
  why: string;
  /** Open the player again. A failure that was a missing file can be fixed
   * while the app runs: native tries the load afresh on every open. */
  retry: () => void;
}

/** The longest reason the card shows. Native's own messages are shorter. */
const WHY_MAX = 120;

/**
 * The native reason in one short line. libmpv's load error is
 * `load libmpv-2.dll: <why> (also tried: <every path>)`: the first clause is
 * the reason, and the rest is folders on the user's disk that belong in a bug
 * report and not on the card. Anything that is not text gives "".
 */
export function playerFaultWhy(e: unknown): string {
  const raw =
    typeof e === "string"
      ? e
      : e instanceof Error
        ? e.message
        : typeof (e as { message?: unknown } | null)?.message === "string"
          ? (e as { message: string }).message
          : "";
  const first = raw
    .replace(/\s*\(also tried:[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return first.length > WHY_MAX
    ? `${first.slice(0, WHY_MAX - 1).trimEnd()}…`
    : first;
}

let current: PlayerFault | null = null;
const listeners = new Set<(f: PlayerFault | null) => void>();

/** The failure of the player's last open, or null. */
export function currentPlayerFault(): PlayerFault | null {
  return current;
}

/** Report a failed open, or take the report back with null. */
export function setPlayerFault(f: PlayerFault | null): void {
  if (f === current) return;
  current = f;
  listeners.forEach((cb) => cb(f));
}

/** Hear every change to the report. Returns the unsubscribe. */
export function onPlayerFault(cb: (f: PlayerFault | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
