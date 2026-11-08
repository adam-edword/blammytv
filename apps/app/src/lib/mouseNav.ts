import { useEffect } from "react";
import { isModalOpen } from "./modalOpen";

/**
 * Mouse side buttons wired to a screen's own view stack.
 *
 * MouseEvent.button: 3 = back (mouse 4), 4 = forward (mouse 5). Every screen
 * that keeps its own view state has to opt in — the app has no router, so
 * there is no single place that knows what "back" means.
 *
 * preventDefault on BOTH phases or WebView2 walks its own history: the
 * default action fires on mousedown, so swallowing only mouseup lets the
 * webview navigate the document out from under the app.
 */
/**
 * The mouse's Back or Forward, pressed on screen (Classic's toolbar). Sends
 * the very event the side button does, so whichever screen is up answers it
 * exactly as it answers the mouse, and a modal still holds it off.
 */
export function requestNav(direction: "back" | "forward"): void {
  window.dispatchEvent(new MouseEvent("mouseup", { button: direction === "back" ? 3 : 4, cancelable: true }));
}

export function useMouseNav(
  onBack: () => void,
  onForward?: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onButton = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      // A modal is a screen of its own; the one underneath must not also
      // navigate. See lib/modalOpen.
      if (isModalOpen()) return;
      e.preventDefault();
      if (e.type !== "mouseup") return;
      if (e.button === 3) onBack();
      else onForward?.();
    };
    window.addEventListener("mousedown", onButton);
    window.addEventListener("mouseup", onButton);
    return () => {
      window.removeEventListener("mousedown", onButton);
      window.removeEventListener("mouseup", onButton);
    };
  }, [enabled, onBack, onForward]);
}
