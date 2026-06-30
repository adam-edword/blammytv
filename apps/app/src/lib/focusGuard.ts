import {
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from "@noriginmedia/norigin-spatial-navigation";

/**
 * Systemic focus-loss safety net for the spatial-nav cursor.
 *
 * On a TV the only way to interact is the D-pad, so if the focused element ever
 * unmounts (a list item deleted, search results swapped, a menu closed) the
 * cursor points at nothing and the remote goes dead. Components should re-home
 * focus when they unmount the focused node — but that's whack-a-mole. This is the
 * net under all of it: a global watchdog that, on any navigation keypress, checks
 * whether focus still points at a real focusable and, if not, re-homes it before
 * norigin processes the key.
 *
 * The recovery target is a per-screen fallback (set via {@link setFocusFallback})
 * with the always-present header tabs as the hard fallback. Stale fallback keys
 * are harmless — every candidate is existence-checked before use.
 */

const HARD_FALLBACK = "tabs";
let softFallback: string | null = null;

/** Screens register where focus should land if it's lost on their page (e.g.
 * "search-kbd", "live-content"). Pass null to clear. */
export function setFocusFallback(key: string | null): void {
  softFallback = key;
}

/** Current fallback — so an overlay (e.g. Settings) can save the underlying
 * screen's fallback, override it while open, and restore it on close. */
export function getFocusFallback(): string | null {
  return softFallback;
}

function focusIsLost(): boolean {
  const cur = getCurrentFocusKey();
  return !cur || !doesFocusableExist(cur);
}

/** If the cursor points at nothing, re-home it to the best available target.
 * Returns true if it recovered. */
export function recoverFocus(): boolean {
  if (!focusIsLost()) return false;
  if (softFallback && doesFocusableExist(softFallback)) {
    setFocus(softFallback);
    return true;
  }
  if (doesFocusableExist(HARD_FALLBACK)) {
    setFocus(HARD_FALLBACK);
    return true;
  }
  return false;
}

let installed = false;

/** Install the global watchdog once (from main). Runs in the capture phase so it
 * recovers before norigin sees the key; the recovering press only re-homes (it
 * doesn't also move), so the cursor reappears predictably and the next press
 * navigates from there. */
export function installFocusGuard(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.key.startsWith("Arrow") && e.key !== "Enter") return;
      if (focusIsLost() && recoverFocus()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}
