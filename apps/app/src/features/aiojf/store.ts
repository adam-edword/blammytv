/**
 * What BlammyTV remembers about AIOStreams' sync between runs (plan 023). None
 * of it is a credential: the token lives in the OS vault (aiojf.rs). This is
 * bookkeeping: when it last synced, the Next Up and Upcoming cards for the
 * home rows, and the played marks that could not be sent yet. What
 * AIOStreams counts as played is stored with the other ledgers
 * (stream/watched.ts `aioWatched`).
 */

import { load, save } from "../../lib/storage";
import { forgetAioWatched } from "../stream/watched";
import type { UpNextCard } from "./rules";

export interface AiojfLocal {
  /** When the last sync finished, ms. */
  lastSync?: number;
  /** The last thing that went wrong, said plainly, for Settings. */
  problem?: string;
  /** The Jellyfin base the cards' art comes from (`aiojf_status`). */
  base?: string;
  nextUp?: UpNextCard[];
  upcoming?: UpNextCard[];
  /** Plays whose ids AIOStreams cannot pack, so nothing was reported. Counted
   * since connecting, for the sync's log line. */
  unpackable?: number;
}

const KEY = "aiojf";
const VERSION = 1;
const QUEUE = "aiojfQueue";

export function loadAiojf(): AiojfLocal {
  return load<AiojfLocal>(KEY, VERSION, {});
}

export function saveAiojf(patch: Partial<AiojfLocal>): AiojfLocal {
  const next = { ...loadAiojf(), ...patch };
  save(KEY, VERSION, next);
  return next;
}

/** Bumped by every sign-out, so a sync already under way can tell it has
 * been overtaken and write nothing back into the store it just cleared. */
let forgets = 0;
export const forgetCount = (): number => forgets;

/** Signed out: the bookkeeping, the queue and the played ticks go. What was
 * merged into Continue Watching stays, as Trakt's does. */
export function forgetAiojf(): void {
  forgets++;
  save(KEY, VERSION, {});
  save(QUEUE, VERSION, []);
  forgetAioWatched();
}

/** Packed ids of titles finished here whose played mark could not be sent,
 * each sent at the next sync. */
export function loadQueue(): string[] {
  const q = load<unknown>(QUEUE, VERSION, []);
  return Array.isArray(q) ? q.filter((x): x is string => typeof x === "string") : [];
}

export function queuePlayed(packedId: string): void {
  const q = loadQueue();
  if (q.includes(packedId)) return;
  save(QUEUE, VERSION, [...q, packedId].slice(-200));
}

/** Take out what was sent. Re-read at the time, so a mark queued while
 * those were on their way stays in. */
export function dropFromQueue(sent: readonly string[]): void {
  const gone = new Set(sent);
  save(QUEUE, VERSION, loadQueue().filter((id) => !gone.has(id)));
}

/**
 * Whether AIOStreams' answer to a played mark settles it: it took it (2xx),
 * or it never will (404, it cannot read the item). Those leave the queue.
 * Anything else is "not now" and keeps the mark: no answer, a 5xx, a 429, a
 * 401 (signed out; the sign-out empties the queue).
 */
export function playedSettled(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404;
}

/** Said when a sync changed anything a screen shows (the rows, the ticks, the
 * Settings line), or when a sign-out cleared it. */
export const AIOJF_SYNCED = "blammytv:aiojf-synced";
