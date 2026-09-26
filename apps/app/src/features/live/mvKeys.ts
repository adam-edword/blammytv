/**
 * Whether a key press is multi-view's to act on (plan 017's keyboard
 * table). Not while typing, not while a dialog has the keyboard, not with
 * a modifier held (those belong to the app and the system).
 *
 * A focused slider keeps its own keys: the volume slider moves on the
 * arrows, Home and End, and taking them here would cancel that, so ← and
 * → would move the sound instead of the volume.
 */
const SLIDER_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function forMultiview(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  if (t) {
    if (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return false;
    if (t.tagName === "INPUT") {
      const type = (t as HTMLInputElement).type;
      if (type !== "range" || SLIDER_KEYS.has(e.key)) return false;
    }
  }
  // An OPEN dialog: one fading out after a click has already let go of the
  // keyboard, and keys pressed in its last 150ms are the grid's again.
  return !document.querySelector("[data-slot='dialog-content'][data-state='open']");
}

/**
 * A multi-view shortcut was just used: the tab is being worked, not the
 * nav. The nav pill that brought you here keeps keyboard focus otherwise,
 * and the bar never dims while the header holds a focus ring (plan 018,
 * U3). Called only for a key the tab or the grid took, never for one the
 * nav handled itself.
 */
export function releaseHeader(): void {
  const at = document.activeElement;
  if (at instanceof HTMLElement && at.closest(".header")) at.blur();
}
