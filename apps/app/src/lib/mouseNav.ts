import { useEffect } from "react";

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
export function useMouseNav(
  onBack: () => void,
  onForward?: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onButton = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
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
