import { useEffect, useRef, useState } from "react";
import { mpvPlayerStart, mpvPlayerFrame, mpvPlayerStop } from "../lib/desktop";
import { CloseIcon } from "./icons";

/**
 * Phase 2 step 2 spike: a live libmpv → <canvas> layer that fills the theater.
 *
 * Starts the native player on `url`, then each animation frame pulls the latest
 * decoded frame (RGBA bytes, over IPC) and draws it to a 2D canvas. We render at
 * the canvas's actual on-screen pixel size (devicePixelRatio-aware) so it's
 * full display resolution — mpv decodes the source at 4K and scales to exactly
 * what the screen shows. mpv plays audio natively. It sits above the <video> but
 * below the theater controls, so the HTML chrome composites on top.
 */
export function MpvCanvas({ url, onClose }: { url: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 1280, h: 720 });
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Keep the canvas's intrinsic size = its on-screen pixel size (capped), so the
  // readback is full resolution and putImageData maps 1:1 (no upscale blur).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      let w = Math.round(rect.width * dpr);
      let h = Math.round(rect.height * dpr);
      w = Math.max(640, Math.min(3840, w));
      h = Math.max(360, Math.min(2160, h));
      w -= w % 2;
      h -= h % 2;
      sizeRef.current = { w, h };
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

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
            const { w, h } = sizeRef.current;
            const buf = await mpvPlayerFrame(w, h);
            if (!cancelled && buf && ctx && buf.length === w * h * 4) {
              const data = new Uint8ClampedArray(buf);
              ctx.putImageData(new ImageData(data, w, h), 0, 0);
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
      <canvas ref={canvasRef} className="mpv-canvas__view" />
      <div className="mpv-canvas__hud">
        <span>libmpv {live ? "• live" : error ? "• error" : "• starting…"}</span>
        <button
          className="mpv-canvas__close"
          type="button"
          aria-label="Close libmpv canvas"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      {error && <div className="mpv-canvas__error">{error}</div>}
    </div>
  );
}
