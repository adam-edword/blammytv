import { useEffect, useRef } from "react";
import {
  tauriCompTheater,
  tauriCompSetRect,
  tauriCompStop,
  type CompRect,
} from "../lib/tauri";
import type { TheaterMeta } from "./Player";

// Wait this long after the channel settles before building the native player, so
// rapid channel switching doesn't thrash mpv + the composition webview.
const OPEN_DEBOUNCE_MS = 150;

/** Box geometry in physical pixels (what the native mpv layer wants). The preview
 * box is rounded 12px in both mini and theater (the theater frame CSS handles the
 * padded layout); true fullscreen squares it off. */
function measure(el: HTMLElement, fullscreen: boolean): CompRect {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  // The box's CSS corner radius (var(--radius) = 12) in physical px. Derive the
  // box's layout→physical scale (covers body zoom *and* dpr) so the native
  // rounding hugs the web focus ring instead of being tighter or looser.
  const scale = el.offsetWidth > 0 ? w / el.offsetWidth : dpr;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    w,
    h,
    radius: fullscreen ? 0 : Math.round(12 * scale),
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
    let lastChangeAt = 0; // rAF timestamp of the last rect change
    let lastSampleAt = 0; // rAF timestamp of the last getBoundingClientRect
    // Sample the box every frame while it's actively moving (a panel-resize drag,
    // the theater transition), then back off to ~6fps once it's been still.
    // `measure()` calls getBoundingClientRect — a forced layout flush — and a
    // playing channel sits on a static box for hours, so polling that every frame
    // is continuous layout churn competing with the video compositor. The idle
    // cadence still catches any move within ~160ms, imperceptible for a tracking
    // overlay; an actual move bumps lastChangeAt and snaps back to per-frame.
    const SETTLE_MS = 400;
    const IDLE_SAMPLE_MS = 160;
    const tick = (ts: number) => {
      const moving = ts - lastChangeAt < SETTLE_MS;
      if (moving || ts - lastSampleAt >= IDLE_SAMPLE_MS) {
        lastSampleAt = ts;
        const rect = measure(el, fsRef.current);
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${rect.radius}`;
        if (rect.w > 0 && rect.h > 0 && key !== last) {
          last = key;
          lastChangeAt = ts;
          if (!opened) {
            opened = true;
            void tauriCompTheater(url, meta, rect, start).catch(() => {});
          } else {
            void tauriCompSetRect(rect).catch(() => {});
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    // Debounce the open: each url change re-runs this effect and clears the
    // pending timer, so flipping quickly through channels only ever builds the
    // native layer for the one you land on (the rest never start).
    const openTimer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, OPEN_DEBOUNCE_MS);
    return () => {
      clearTimeout(openTimer);
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
