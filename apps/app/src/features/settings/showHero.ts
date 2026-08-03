import { load, save } from "../../lib/storage";

/**
 * Opt-out (default ON): the sliding hero carousel at the top of Stream.
 *
 * Off removes it ENTIRELY, with no gap — the rows simply start at the top
 * of the tab. It is the tallest thing on the screen and the one piece of it
 * that is not a list, so someone who came for their library rather than for
 * a recommendation is looking past ~90vh of it every time.
 *
 * The hero-sources picker only makes sense while there is a hero to pick
 * sources FOR, so CustomizeTab hides that setting when this is off.
 */

const KEY = "showHero";
const VERSION = 1;

export function loadShowHero(): boolean {
  return load<boolean>(KEY, VERSION, true);
}

export function saveShowHero(on: boolean): void {
  save(KEY, VERSION, on);
}
