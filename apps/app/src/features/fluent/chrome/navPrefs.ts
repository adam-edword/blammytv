import { load, save } from "../../../lib/storage";

/**
 * Whether Fluent's navigation pane is collapsed to the rail (the hamburger,
 * plan 035). The full pane is the default; the choice is remembered. A stored
 * value that is not a boolean reads as the pane.
 */
const KEY = "fluentNavRail";
const VERSION = 1;

export function loadNavRail(): boolean {
  return load<unknown>(KEY, VERSION, false) === true;
}

export function saveNavRail(rail: boolean): void {
  save(KEY, VERSION, rail);
}
