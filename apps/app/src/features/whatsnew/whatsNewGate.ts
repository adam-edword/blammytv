import { load, save } from "../../lib/storage";
import { APP_VERSION } from "../../lib/version";
import { NEWEST } from "./releases";

/**
 * When What's New shows by itself: once per release, on the first launch of a
 * build that has it.
 *
 * The stored value is the newest release this profile has seen ("1.2"), or
 * nothing. It is per device, not a setting, so settingsExport files it under
 * never.
 */
const KEY = "whatsNewSeen";
const VERSION = 1;
const REQUEST_EVENT = "blammytv:whats-new";

/** "1.0.42" or "1.2" as [major, minor]; anything else is [0, 0]. */
function majorMinor(v: string): [number, number] {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

function compare(a: string, b: string): number {
  const [am, an] = majorMinor(a);
  const [bm, bn] = majorMinor(b);
  return am - bm || an - bn;
}

/**
 * The rule, pure. Shown when the profile has not seen `newest` yet AND this
 * build is at or past it, compared by major.minor: a 1.0.x build has no
 * business announcing 1.2. A first run gets onboarding instead, and finishing
 * that stamps the release (markOnboarded), so it never follows straight on.
 */
export function shouldShowWhatsNew(o: {
  seen: string | null;
  version: string;
  newest: string;
  firstRun: boolean;
}): boolean {
  if (o.firstRun) return false;
  if (compare(o.version, o.newest) < 0) return false;
  return o.seen === null || compare(o.seen, o.newest) < 0;
}

function loadSeen(): string | null {
  const v = load<unknown>(KEY, VERSION, null);
  return typeof v === "string" ? v : null;
}

/** App's launch check. `firstRun` is whether onboarding is about to show. */
export function whatsNewDue(firstRun: boolean): boolean {
  return shouldShowWhatsNew({ seen: loadSeen(), version: APP_VERSION, newest: NEWEST.version, firstRun });
}

/** Stamp the newest release as seen: Continue, Escape, and finishing onboarding. */
export function markWhatsNewSeen(): void {
  save(KEY, VERSION, NEWEST.version);
}

/** Settings → App → What's New: open it again on demand. */
export function requestWhatsNew(): void {
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT));
}

export function onWhatsNewRequest(cb: () => void): () => void {
  window.addEventListener(REQUEST_EVENT, cb);
  return () => window.removeEventListener(REQUEST_EVENT, cb);
}
