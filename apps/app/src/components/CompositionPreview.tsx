import { useEffect, useRef } from "react";
import {
  tauriCompTheater,
  tauriCompSetRect,
  tauriCompStop,
  type CompRect,
} from "../lib/tauri";
import type { TheaterMeta } from "./Player";

/** Box geometry in physical pixels (what the native mpv layer wants). The preview
 * box is rounded 12px in both mini and theater (the theater frame CSS handles the
 * padded layout); true fullscreen squares it off. */
function measure(el: HTMLElement, fullscreen: boolean): CompRect {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr),
    h: Math.round(r.height * dpr),
    radius: fullscreen ? 0 : Math.round(12 * dpr),
  };
}

/**
 * The Tauri preview surface: a plain box that the native composition player
 * (mpv + transparent overlay) renders into. We poll the box's on-screen rect and
 * keep the native layer aligned to it, so it tracks window/panel resizes and the
 * theater toggle. Replaces the in-page <video> on Tauri, where hls.js can't play
 * the IPTV streams — only mpv can.
 */
export function CompositionPreview({
  url,
  meta,
  fullscreen,
  start = 0,
}: {
  url: string;
  meta: TheaterMeta;
  fullscreen: boolean;
  /** Resume position (seconds) when reopening, e.g. reclaiming from the popout. */
  start?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Live fullscreen flag for the rAF loop (re-rects without re-running the effect).
  const fsRef = useRef(fullscreen);
  fsRef.current = fullscreen;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let opened = false;
    let last = "";
    const tick = () => {
      const rect = measure(el, fsRef.current);
      const key = `${rect.x},${rect.y},${rect.w},${rect.h},${rect.radius}`;
      if (rect.w > 0 && rect.h > 0 && key !== last) {
        last = key;
        if (!opened) {
          opened = true;
          void tauriCompTheater(url, meta, rect, start).catch(() => {});
        } else {
          void tauriCompSetRect(rect).catch(() => {});
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void tauriCompStop().catch(() => {});
    };
    // meta is pushed to the overlay on open; a url change rebuilds the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // The native layer follows this box; theater + fullscreen layout both come from
  // the parent .live-screen--theater / --fullscreen CSS, which the rAF picks up.
  // (The `fullscreen` prop only drives the corner radius via measure().)
  return (
    <div ref={ref} className="now-playing__art" style={{ background: "#000" }} />
  );
}
