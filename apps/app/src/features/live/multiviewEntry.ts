import type { Fixture } from "../sports/model";

/**
 * The ways into the Multi-view tab from elsewhere (plan 017), and what
 * Sports hands it on the way.
 *
 * Multi-view used to be a mode of the Sports screen, which held its state
 * and fed it the live games. It is a tab of its own now, so the two meet
 * here instead.
 */

const EVENT = "blammytv:open-multiview";

/** Go to the Multi-view tab. App listens and flips the nav. */
export function requestMultiview(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onMultiviewRequest(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/**
 * OUT: Watch in player (plan 017, "Getting in and out"). A tile hands its
 * channel to the main player (mpv) with its full controls: App flips to
 * the Guide, which leaves the Multi-view tab and so stops every tile, and
 * the Guide takes the channel as it mounts (`takeWatchRequest`).
 */
const WATCH = "blammytv:watch-in-player";
let watch: string | null = null;

export function requestWatchInPlayer(channelId: string): void {
  watch = channelId;
  window.dispatchEvent(new Event(WATCH));
}

export function onWatchRequest(cb: () => void): () => void {
  window.addEventListener(WATCH, cb);
  return () => window.removeEventListener(WATCH, cb);
}

/** The channel asked for, once: reading it clears it. */
export function takeWatchRequest(): string | null {
  const id = watch;
  watch = null;
  return id;
}

/**
 * THE LIVE GAMES, as Sports last saw them.
 *
 * The rail's shortcut row: games already matched to a channel (013 kept
 * them at the top because sport is what multi-view is mostly for). Only the
 * Sports board knows them, and fetching its whole board again from here
 * would be every league in the catalog (SportsScreen's own numbers: 151
 * requests a day), so the board publishes what it has and the tab reads it.
 *
 * GONE AFTER HALF AN HOUR. The board stops polling once you leave it, so
 * this is a snapshot, and a game that finished while you were elsewhere
 * would sit there as live. Thirty minutes matches the catalog's own TTL
 * (peekLive goes null at the same age). An old snapshot is dropped rather
 * than shown, and the search still reaches every channel.
 */
const FRESH_MS = 30 * 60_000;
let games: { at: number; list: Fixture[] } | null = null;

export function publishLiveGames(list: Fixture[]): void {
  games = { at: Date.now(), list };
}

export function peekLiveGames(): Fixture[] {
  if (!games || Date.now() - games.at > FRESH_MS) return [];
  return games.list;
}
