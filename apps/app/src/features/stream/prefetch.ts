import type { StreamSource } from "./model";

/**
 * The next episode's sources, asked for before they are needed.
 *
 * The roll to the next episode used to ask for its sources after the
 * countdown, about four seconds of nothing before the picture. The Up Next
 * card's window opening (the credits) is the first moment the next episode is
 * likely, and the end-of-file card the second, so the list is asked for then
 * and kept here for `playEpisode` to take.
 *
 * ONE LIST AT A TIME, for one episode. Signed in, AIOStreams reuses a source
 * list for 180 seconds, so a kept promise older than that is asked for again
 * rather than trusted: debrid links are short-lived. It never outlives the
 * play that started it: StreamScreen drops it on a stop, a new play and a
 * source switch.
 */

/** How long AIOStreams itself holds a list (resolveVodSources). */
export const PREFETCH_TTL_MS = 180_000;

interface Kept {
  episodeId: string;
  at: number;
  sources: Promise<StreamSource[]>;
}

let kept: Kept | null = null;

/** Whether a kept list is the one asked for and still young enough. At the
 * limit it is stale. */
function usable(k: Kept | null, episodeId: string, now: number): k is Kept {
  return !!k && k.episodeId === episodeId && now - k.at < PREFETCH_TTL_MS;
}

/** Ask for this episode's sources, once: a list already kept for it, and
 * still young, is left as it is. A rejection is forgotten, so the next ask
 * (the end of the file, or the roll itself) tries again and nobody sees it. */
export function prefetchSources(
  episodeId: string,
  ask: () => Promise<StreamSource[]>,
  now: number = Date.now(),
): void {
  if (usable(kept, episodeId, now)) return;
  const mine: Kept = { episodeId, at: now, sources: ask() };
  kept = mine;
  mine.sources.catch(() => {
    if (kept === mine) kept = null;
  });
}

/** The kept list for this episode, when it is the right one and young
 * enough, else null. Taking it spends it: the roll that used it starts a new
 * play, and what is left would only be a list to go stale. */
export function takePrefetched(
  episodeId: string,
  now: number = Date.now(),
): Promise<StreamSource[]> | null {
  const k = kept;
  kept = null;
  return usable(k, episodeId, now) ? k.sources : null;
}

/** Forget whatever is kept. */
export function dropPrefetch(): void {
  kept = null;
}
