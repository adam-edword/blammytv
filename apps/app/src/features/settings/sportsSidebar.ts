import { load, save } from "../../lib/storage";

/**
 * Whether the Sports hub's sidebar is collapsed to its rail.
 *
 * Opt-in (default OFF): the sidebar is how following works, and following
 * is how the board gets narrowed, so someone who has never opened it should
 * see it rather than a strip of icons.
 *
 * Persisted because collapsing it is a statement about how you want to use
 * the screen, not a thing you are doing for a moment. Losing it on every
 * navigation makes the control feel broken, which is what the equivalent
 * unpersisted state on Live TV does today.
 */

const KEY = "sportsSidebarCollapsed";
const VERSION = 1;

export function loadSidebarCollapsed(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  save(KEY, VERSION, collapsed);
}
