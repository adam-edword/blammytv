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
