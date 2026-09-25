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
  return !document.querySelector("[data-slot='dialog-content']");
}
