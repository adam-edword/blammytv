/**
 * Is a modal covering the app right now?
 *
 * A one-bit module rather than a prop threaded through four components, and
 * it exists because of a bug that only shows up when two screens are alive
 * at once. Settings and Themes render as SIBLINGS of `<main>` (App.tsx), so
 * the screen underneath stays mounted — and the sports theater and the
 * tournament draw both listen for Escape and the mouse's back button on
 * `window`. Nothing coordinated them, so one Escape closed the modal AND
 * the screen behind it: out of Settings and out of a 105 match draw, or out
 * of Settings and out of a playing stream.
 *
 * They are sibling window listeners rather than a bubbling chain, so
 * stopPropagation cannot help; the screen underneath has to know not to
 * act. A prop could carry that, but it would have to pass through
 * SportsScreen, which does not otherwise care, to reach two leaves.
 *
 * Read at EVENT TIME, never during render, so nothing subscribes to it and
 * no component re-renders when it flips.
 */
let open = false;

/** App owns this. Nothing else should call it. */
export function setModalOpen(value: boolean): void {
  open = value;
}

/** For a window-level handler deciding whether this event is meant for it. */
export function isModalOpen(): boolean {
  return open;
}
