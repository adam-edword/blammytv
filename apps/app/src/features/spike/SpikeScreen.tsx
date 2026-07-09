import { useCallback, useEffect, useRef, useState } from "react";
import {
  tauriSpikePlay,
  tauriSpikeStop,
} from "../../lib/tauri";

/**
 * DEV-ONLY layer-inversion spike page (`?spike=1`, opened by Ctrl+Shift+L in
 * the main window — see App.tsx / spike.rs). Renders inside a TRANSPARENT
 * Tauri window with a native mpv child parked at the BOTTOM of the z-order:
 * this page's opaque chrome must appear ABOVE the video, and the transparent
 * hole must show it. Throwaway — delete with spike.rs when the inversion
 * ships or is rejected.
 *
 * Everything is inline-styled on purpose: the spike must not touch the real
 * stylesheets it's auditioning to replace parts of.
 */

/** Public HLS test stream (Big Buck Bunny) when no channel URL was handed
 * over — network-dependent but reliable, and mpv plays HLS natively. */
const FALLBACK_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const CHROME_BG = "#0b0d12"; // opaque chrome — anything NOT the hole
const CARD_BG = "rgba(20, 24, 34, 0.55)";

export function SpikeScreen() {
  const params = new URLSearchParams(window.location.search);
  const streamUrl = params.get("u") || FALLBACK_URL;
  // Never render the full URL — Xtream credentials live in it.
  let streamHost = "test stream";
  try {
    if (params.get("u")) streamHost = new URL(streamUrl).host;
  } catch {
    /* keep the label */
  }

  const [mode, setMode] = useState<"flip" | "bitblt" | "stopped">("flip");
  const [status, setStatus] = useState("starting…");

  const play = useCallback(
    (bitblt: boolean) => {
      setStatus("opening mpv…");
      tauriSpikePlay(streamUrl, bitblt)
        .then(() => {
          setMode(bitblt ? "bitblt" : "flip");
          setStatus("playing");
        })
        .catch((e) => setStatus(`error: ${String(e)}`));
    },
    [streamUrl],
  );

  const stop = useCallback(() => {
    void tauriSpikeStop()
      .then(() => {
        setMode("stopped");
        setStatus("stopped");
      })
      .catch((e) => setStatus(`error: ${String(e)}`));
  }, []);

  // Auto-play (flip model) once on mount. StrictMode double-fires effects;
  // the ref keeps it to one real open.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    play(false);
  }, [play]);

  const btn: React.CSSProperties = {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    font: "600 13px system-ui",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        font: "14px/1.45 system-ui",
        color: "#fff",
      }}
    >
      {/* Opaque chrome: top bar, left rail, bottom bar. The remaining
        * rectangle is THE HOLE — no background, video must show through. */}
      <header
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 64,
          background: CHROME_BG,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 16px",
          zIndex: 2,
        }}
      >
        <strong>Layer spike</strong>
        <span style={{ opacity: 0.6 }}>
          {streamHost} · {mode} · {status}
        </span>
        <span style={{ flex: 1 }} />
        <button style={btn} onClick={() => play(false)}>
          Play flip
        </button>
        <button style={btn} onClick={() => play(true)}>
          Play bitblt
        </button>
        <button style={btn} onClick={stop}>
          Stop
        </button>
      </header>

      <aside
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          bottom: 96,
          width: 230,
          background: CHROME_BG,
          padding: 14,
          zIndex: 2,
          fontSize: 12.5,
          overflow: "auto",
        }}
      >
        <p style={{ fontWeight: 700, margin: "0 0 8px" }}>Check:</p>
        <ol style={{ margin: 0, paddingLeft: 18, opacity: 0.85 }}>
          <li>Video fills the hole (transparency works)</li>
          <li>This chrome + both cards sit ABOVE the video</li>
          <li>Glass card: is the video behind it blurred, or only tinted?</li>
          <li>Bouncing dot animates smoothly over video (no tearing)</li>
          <li>Drag another window across, minimize/restore — artifacts?</li>
          <li>Flip vs bitblt: which shows video? brightness identical?</li>
          <li>HDR channel if available: still bright?</li>
        </ol>
        <p style={{ opacity: 0.6, marginTop: 10 }}>
          Playing takes over the shared mpv instance — the main window's
          channel stops. Close this window to release it.
        </p>
      </aside>

      <footer
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 96,
          background: CHROME_BG,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          opacity: 0.9,
        }}
      >
        Opaque footer — video must never bleed through this bar.
      </footer>

      {/* Solid card overlapping the hole: the settings-over-video proof. */}
      <div
        style={{
          position: "absolute",
          top: 120,
          right: 40,
          width: 260,
          padding: 16,
          borderRadius: 12,
          background: CHROME_BG,
          border: "1px solid rgba(255,255,255,0.15)",
          zIndex: 2,
        }}
      >
        <strong>Opaque card</strong>
        <p style={{ margin: "6px 0 0", opacity: 0.7, fontSize: 13 }}>
          Fully covers the video underneath — this is “settings over player.”
        </p>
      </div>

      {/* Glass card: does backdrop-filter reach the NATIVE video behind the
        * webview, or only webview content? Expected: tint without blur —
        * that's a design constraint for the real inversion, record it. */}
      <div
        style={{
          position: "absolute",
          bottom: 140,
          right: 60,
          width: 280,
          padding: 16,
          borderRadius: 12,
          background: CARD_BG,
          border: "1px solid rgba(255,255,255,0.2)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          zIndex: 2,
        }}
      >
        <strong>Glass card</strong>
        <p style={{ margin: "6px 0 0", opacity: 0.8, fontSize: 13 }}>
          If the video behind this is blurred, WebView2 samples the native
          layer. If it's only tinted, glass-over-video needs another trick.
        </p>
      </div>

      {/* Compositing smoothness probe: a dot bouncing across the hole. */}
      <style>{`@keyframes spike-x { from { transform: translateX(0); } to { transform: translateX(56vw); } }`}</style>
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: 250,
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "#ff4757",
          boxShadow: "0 0 12px #ff4757",
          animation: "spike-x 2.2s ease-in-out infinite alternate",
          zIndex: 2,
        }}
      />
    </div>
  );
}
