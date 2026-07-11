import { load, save } from "../../lib/storage";

/**
 * Opt-in (default OFF): clicking a MOVIE card plays the best cached
 * source immediately instead of opening the detail page. Series always
 * browse (no single obvious thing to play), and when nothing is cached
 * the click falls back to the detail page — the same safety rail Watch
 * Now uses. Read at click time; no subscription needed.
 */

const KEY = "oneClickPlay";
const VERSION = 1;

export function loadOneClickPlay(): boolean {
  return load<boolean>(KEY, VERSION, false);
}

export function saveOneClickPlay(on: boolean): void {
  save(KEY, VERSION, on);
}
