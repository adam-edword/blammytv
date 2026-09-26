import { useEffect, useState } from "react";

/** How long the pointer has to rest before the chrome goes quiet (plan 017). */
export const IDLE_MS = 2000;

/**
 * Idle after IDLE_MS without the pointer, a key or the wheel, but never
 * while the pointer rests on the header (or on `busy`, the caller's own
 * bar), keyboard focus is in one of them, or a dialog is open: chrome that
 * dims under your hand reads as chrome about to go away.
 *
 * Checked when the timer fires rather than tracked with enter/leave: the
 * header's children take the pointer while the header itself does not, and
 * `:hover` already knows the answer for every case at the moment it matters.
 *
 * Multi-view's (plan 017), shared since plan 019 (K13) so the Guide's
 * theater and the Sports theater quiet the header the same way. Off while
 * `enabled` is false: no listeners, and never idle.
 */
export function useIdle(enabled = true, busy?: string): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    const probe =
      ".header:hover, .header :focus-visible, [data-slot='dialog-content']" +
      (busy ? `, ${busy}` : "");
    let t = 0;
    const arm = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (document.querySelector(probe)) arm();
        else setIdle(true);
      }, IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    arm();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    // The wheel too: turning the volume over a tile should show the slider.
    window.addEventListener("wheel", wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, [enabled, busy]);
  return idle;
}

/**
 * The header at multi-view's quiet level while a theater is up and the
 * pointer rests (plan 019, K13). A flag on the root, because the header is
 * App's and the theaters are not; base.css does the dimming.
 */
export function useQuietHeader(active: boolean): void {
  const idle = useIdle(active);
  useEffect(() => {
    const root = document.documentElement;
    if (active && idle) root.dataset.headerQuiet = "1";
    else delete root.dataset.headerQuiet;
    return () => {
      delete root.dataset.headerQuiet;
    };
  }, [active, idle]);
}
