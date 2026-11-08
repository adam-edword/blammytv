import type { Fixture } from "./model";

/**
 * The two sides in the order the sport reads them (Adam, 1.2.5: "intuition
 * would assume this is notre dame at miami, but its miami at notre dame").
 *
 * North American sports list the visitors first ("Miami at Notre Dame"), so
 * the away side takes the first slot, top or left. Everyone else, soccer
 * above all, lists the home side first ("Arsenal v Chelsea"), as ESPN does,
 * and keeps it. The cards draw `home` in the first slot, so this hands them
 * a game with the two swapped where the sport reads away first. Display
 * only: pass the original game on to anything that matches or opens it.
 *
 * Its own module so the cards can share it and still hot-swap (lib/
 * reducedMotion.ts has the reason).
 */
const AWAY_FIRST = new Set(["football", "basketball", "baseball", "hockey", "lacrosse"]);

export function awayFirst(game: Fixture): boolean {
  return AWAY_FIRST.has(game.leagueKey.split("/")[0]);
}

export function inReadingOrder<T extends Fixture>(game: T): T {
  return awayFirst(game) ? { ...game, home: game.away, away: game.home } : game;
}
