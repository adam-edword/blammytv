import type { Fixture } from "./model";

/**
 * Home's Today's Games row opens a game in the Sports theater (plan 033).
 * The game lives on the Sports board, so Home asks rather than plays: App
 * flips to the Sports tab, and the board takes the game as it mounts and
 * opens it, the way a card on its own row does. The mailbox shape of
 * stream/openRequest.ts, for the same reason: the tab switch mounts the
 * board after the event has gone.
 */
const EVENT = "blammytv:open-game";
let pending: Fixture | null = null;

export function requestOpenGame(game: Fixture): void {
  pending = game;
  window.dispatchEvent(new Event(EVENT));
}

export function onOpenGameRequest(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** The game asked for, once: reading it clears it. */
export function takeOpenGameRequest(): Fixture | null {
  const g = pending;
  pending = null;
  return g;
}
