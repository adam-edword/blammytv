import { load, save } from "../../lib/storage";

/**
 * Opt-in (default OFF): finished games drop out of the Today's Games row.
 *
 * OFF by default, where the day grids' compaction is on, and the two
 * defaults disagree on purpose. Compacting a result keeps it: the score is
 * still there, on one line instead of six. This HIDES it, and a board that
 * silently withholds what happened is the wrong thing to hand somebody who
 * has not asked for it.
 *
 * It is worth having because the row is a different question from the
 * grid. The row asks "what can I watch", and by the evening it is mostly
 * games that answer "nothing, it is over".
 */

const KEY = "hideFinishedRow";
const VERSION = 1;

export function loadHideFinishedRow(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveHideFinishedRow(on: boolean): void {
  save(KEY, VERSION, on);
}
