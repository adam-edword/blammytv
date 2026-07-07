import { useEffect, useState } from "react";
import type { TheaterMeta } from "../../lib/tauri";

/**
 * The on-video controls, rendered in the SEPARATE transparent overlay webview
 * that Rust composites over the mpv child (main.tsx routes `?overlay=1` here).
 * It drives mpv through the Rust-injected `window.overlayApi` bridge — NOT
 * through Tauri invokes.
 *
 * Phase 1: a deliberately minimal bar (play/pause + close) — just enough to
 * prove the composite, the bridge, and the geometry. Phase 2 replaces this
 * with the old build's full overlay ported verbatim.
 */
/** Exactly the bridge Rust injects (comp.rs OVERLAY_BRIDGE_JS). Note getMeta
 * is a Promise but getLoading is a SYNCHRONOUS boolean; the on* subscribers
 * return an unsubscribe fn. */
interface OverlayApi {
  getMeta(): Promise<TheaterMeta | null>;
  onMeta(cb: (m: TheaterMeta | null) => void): () => void;
  getLoading(): boolean;
  onLoading(cb: (l: boolean) => void): () => void;
  setPause(paused: boolean): void;
  close(): void;
}

declare global {
  interface Window {
    overlayApi?: OverlayApi;
  }
}

export function TheaterOverlay() {
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const api = window.overlayApi;
    if (!api) return; // plain browser (no bridge) — render inert.
    setLoading(api.getLoading()); // SYNC boolean — not a promise
    const offLoading = api.onLoading(setLoading);
    return () => offLoading();
  }, []);

  const togglePlay = () => {
    setPaused((p) => {
      const next = !p;
      window.overlayApi?.setPause(next);
      return next;
    });
  };

  return (
    <div className="overlay">
      {loading && <div className="overlay__spinner" aria-hidden />}
      <button
        type="button"
        className="overlay__btn overlay__close"
        onClick={() => window.overlayApi?.close()}
        aria-label="Close player"
      >
        ✕
      </button>
      <button
        type="button"
        className="overlay__btn overlay__play"
        onClick={togglePlay}
        aria-label={paused ? "Play" : "Pause"}
      >
        {paused ? "▶" : "❚❚"}
      </button>
    </div>
  );
}
