import { load, save } from "../../lib/storage";

/**
 * Whether the multi-view notice has been acknowledged (plan 013).
 *
 * Adam's call: shown on first open, "Got it", never again. Its own module
 * rather than state inside the component, for the reason every other
 * preference here has one — the component unmounts with the grid, and a
 * flag that dies with its component is a notice that comes back.
 *
 * Not a settings-tab preference. There is deliberately no UI to un-see it:
 * the notice exists to be read once before the first grid, and a toggle for
 * re-reading it would be a control nobody looks for.
 */
const KEY = "multiviewNoticeSeen";
const VERSION = 1;

export function multiviewNoticeSeen(): boolean {
  return load<boolean>(KEY, VERSION, false) === true;
}

export function markMultiviewNoticeSeen(): void {
  save(KEY, VERSION, true);
}
