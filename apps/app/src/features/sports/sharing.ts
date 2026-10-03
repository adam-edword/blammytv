import { normalize } from "./matcher";
import type { Shared } from "./matcher";
import type { Game } from "./model";

/**
 * How many games share each network at a game's kick-off, from the board.
 *
 * The odds model's split (matcher.matchGame): a network's own channel shows
 * one game at a time, so "CBS 4K UHD (Event Only)" with four CBS games at
 * noon has a one-in-four chance of showing any of them (Adam's board,
 * 2026-10-02).
 *
 * THE BOARD IS WHAT IT KNOWS: the leagues you follow, as fetched, before
 * the sidebar narrows anything. A college game on CBS at noon counts only
 * if college football is on your board.
 *
 * Games within SHARE_WINDOW of each other count, either side: NFL's 1:00
 * and 4:25 slots don't share, 4:05 and 4:25 do, and an ESPN doubleheader
 * 2.5 hours apart doesn't.
 */
export const SHARE_WINDOW_MS = 150 * 60_000;

/** Works out the board once; the answer for one game is then a lookup. */
export function sharing(
  board: readonly Game[],
): (game: Game, networks?: readonly string[]) => Shared | undefined {
  const on = new Map<string, Map<string, number>>();
  for (const g of board) {
    const at = g.start.getTime();
    for (const name of g.broadcasts) {
      const key = normalize(name);
      if (!key) continue;
      let games = on.get(key);
      if (!games) on.set(key, (games = new Map()));
      games.set(g.id, at);
    }
  }
  return (game, networks = game.broadcasts) => {
    const at = game.start.getTime();
    let out: Record<string, number> | undefined;
    for (const name of networks) {
      const key = normalize(name);
      const games = on.get(key);
      if (!games) continue;
      let others = 0;
      for (const [id, t] of games) if (id !== game.id && Math.abs(t - at) < SHARE_WINDOW_MS) others++;
      if (others > 0) (out ??= {})[key] = others + 1;
    }
    return out;
  };
}

/** Whether two answers are the same, so a game that keeps its count keeps
 * its object (withChannels). */
export function sameShared(a: Shared | undefined, b: Shared | undefined): boolean {
  if (a === b) return true;
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  return ka.length === kb.length && ka.every((k) => a?.[k] === b?.[k]);
}
