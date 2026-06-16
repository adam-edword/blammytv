import { useEffect, useRef, useState } from "react";
import { mpvPlayerStart, mpvPlayerFrame, mpvPlayerStop } from "../lib/desktop";
import { CloseIcon } from "./icons";

// Internal render size — mpv scales the source to this; we read it back and
// blit to the canvas. Kept modest for the step-2 spike (bounded readback).
const W = 960;
const H = 540;

/**
 * Phase 2 step 2 spike: a live libmpv → <canvas> overlay.
 *
 * Starts the native player on `url`, then each animation frame pulls the latest
 * decoded frame (RGBA bytes, over IPC) and draws it to a 2D canvas. mpv plays
 * audio natively. This proves frames land in-page (HTML composites on top); the
 * real theater integration + control wiring comes next.
 */
export function MpvCanvas({ url, onClose }: { url: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let inflight = false;
    const ctx = canvasRef.current?.getContext("2d") ?? null;

    (async () => {
      const res = await mpvPlayerStart(url);
      if (cancelled) return;
      if (!res?.ok) {
        setError(res?.error ?? "Couldn't start libmpv player.");
        return;
      }
      const tick = async () => {
        if (cancelled) return;
        if (!inflight) {
          inflight = true;
          try {
            const buf = await mpvPlayerFrame(W, H);
            if (!cancelled && buf && ctx && buf.length === W * H * 4) {
              const data = new Uint8ClampedArray(buf);
              ctx.putImageData(new ImageData(data, W, H), 0, 0);
              if (!live) setLive(true);
            }
          } finally {
            inflight = false;
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      void mpvPlayerStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div className="mpv-canvas">
      <div className="mpv-canvas__bar">
        <span className="mpv-canvas__label">
          libmpv → canvas {live ? "• live" : error ? "• error" : "• starting…"}
        </span>
        <button
          className="mpv-canvas__close"
          type="button"
          aria-label="Close libmpv canvas"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="mpv-canvas__view" />
      {error && <div className="mpv-canvas__error">{error}</div>}
    </div>
  );
}
