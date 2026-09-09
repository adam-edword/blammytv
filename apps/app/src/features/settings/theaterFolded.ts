import { load, save } from "../../lib/storage";

/**
 * Opt-in (default OFF): the Sports theater's side column folds to a strip,
 * giving its 360px to the picture.
 *
 * NOT the same key as the Live sidebar's collapse, even though it is the
 * same gesture with the same mark. They are different panels on different
 * screens, and one key would have folding the guide silently fold the
 * theater the next time you opened a game.
 *
 * OFF by default because the column is the feature: it is the list of your
 * channels carrying this game, which is the whole reason the Sports tab
 * exists rather than being a scores app.
 */

const KEY = "sportsTheaterFolded";
const VERSION = 1;

export function loadTheaterFolded(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveTheaterFolded(on: boolean): void {
  save(KEY, VERSION, on);
}
