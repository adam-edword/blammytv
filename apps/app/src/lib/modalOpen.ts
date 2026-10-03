/**
 * Is a modal covering the app right now?
 *
 * A one-bit module rather than a prop threaded through four components, and
 * it exists because of a bug that only shows up when two screens are alive
 * at once. Settings renders as a SIBLING of `<main>` (App.tsx), so the
 * screen underneath stays mounted and keeps its own window listeners.
 * Nothing coordinated them, so one Escape closed the modal AND the screen
 * behind it: out of Settings and out of a 105 match draw, or out of
 * Settings and out of a playing stream.
 *
 * WHAT IS LEFT OF IT (v0.10.33). Settings and the palette are both Radix
 * dialogs now, and Radix marks every Escape it takes (`defaultPrevented`)
 * on the document before any window listener hears it. So the screens'
 * ESCAPE handlers read the mark instead; the tennis draw and the Sports
 * theater stopped asking here. These readers still need the bit, because
 * the mark cannot reach them:
 *
 * - `mouseNav`: the mouse's Back button is not a key, and Radix does not
 *   touch it. App closes the modal on it, but App's listener is added when
 *   the modal opens, after every screen's, so a screen hears the press
 *   first and would walk back a step under Settings.
 * - Multi-view's replace-a-tile Escape listens on WINDOW in the CAPTURE
 *   phase, ahead of Radix's document listener, so there is no mark yet
 *   when it hears the key.
 * - The player's keys (`TheaterOverlay`'s `onDocKey`): Radix marks the
 *   Escape it takes and nothing else, so over a playing preview the arrows
 *   and Space reached the stream under Settings. Every key stands down
 *   here, Escape included (its `defaultPrevented` line stays for a menu).
 * - The header's `/` and Ctrl+F: Radix does not mark them either, and they
 *   switched the tab behind the modal.
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
