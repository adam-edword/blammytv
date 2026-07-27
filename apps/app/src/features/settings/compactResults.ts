import { load, save } from "../../lib/storage";

/**
 * Opt-out (default ON): a finished game in the day grids collapses to one
 * line instead of a full card.
 *
 * On by default because a day is mostly results by the evening, and a grid
 * of fifteen full cards for games already played buries the two that are
 * still to come. Off for anyone who would rather see the crests.
 */

const KEY = "compactResults";
const VERSION = 1;

export function loadCompactResults(): boolean {
  return load<boolean>(KEY, VERSION, true);
}

export function saveCompactResults(on: boolean): void {
  save(KEY, VERSION, on);
}
