/**
 * Hand focus back to where it was before a modal, without popping its
 * tooltip.
 *
 * Focus returned after a key (Escape, most often) counts as keyboard focus,
 * so the element matches :focus-visible, and Hint opens a control's tooltip
 * on exactly that. Closing Settings with Escape put a "Settings" bubble
 * under the gear every time. The element is marked for the length of the
 * focus call and Hint stays shut for it; the focus ring still shows, as it
 * did before Settings moved focus at all.
 *
 * `focus({ focusVisible: false })` is the platform's answer and would be
 * better, but Chromium ignores it (measured on 141): the element still
 * matched :focus-visible.
 */
export function returnFocus(el: HTMLElement | null | undefined): void {
  if (!el?.isConnected) return;
  el.setAttribute("data-focus-return", "");
  try {
    el.focus({ preventScroll: true });
  } finally {
    el.removeAttribute("data-focus-return");
  }
}
