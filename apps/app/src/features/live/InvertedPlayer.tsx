import { useEffect, useRef } from "react";
import {
  tauriInvOpen,
  tauriInvSetRect,
  tauriInvStop,
  type CompRect,
} from "../../lib/tauri";
import { holeClip } from "./hole";
import { currentZoom } from "../settings/uiScale";

/* The geometry driver (descended from the old build's CompositionPreview).
 * mpv renders into a rect we push in PHYSICAL device pixels, so we measure
 * the box in CSS px and multiply by devicePixelRatio. One rAF loop diffs a
 * serialized rect key and follows the box (scroll, window/column resize,
 * layout shifts) with a single inv_set_rect per real change; the first frame
 * opens with inv_open. A 150ms debounce means fast channel-flipping never
 * builds mpv for skipped channels.
 *
 * The video child sits BELOW the webview (inv.rs), so it only shows where
 * nothing paints over it — the driver cuts a clip-path hole through
 * .app-shell (the window's only opaque layer, see base.css .invert-player)
 * exactly at the slot. */
const OPEN_DEBOUNCE_MS = 150;
/** CSS corner radius of #player-slot — keep in sync with .hero__preview. */
const RADIUS_CSS = 12;
const SLOT_ID = "player-slot";

function measure(el: HTMLElement, squared: boolean): CompRect {
  // Rects are VISUAL viewport px (UI-scale zoom included), so × dpr is the
  // physical rect regardless of zoom. Only the radius needs the zoom
  // factor: the slot's CSS radius is a pre-zoom unit.
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr),
    h: Math.round(r.height * dpr),
    // Theater/fullscreen fill to edges (square); only the mini box is rounded.
    radius: squared ? 0 : Math.round(RADIUS_CSS * currentZoom() * dpr),
  };
}

/**
 * Headless — renders nothing. While mounted (Tauri only, with a real stream
 * URL), it opens the native mpv player into #player-slot and keeps it glued to
 * the box. Unmount tears mpv down. Re-run on `url` change rebuilds cleanly for
 * a channel switch.
 */
export function InvertedPlayer({
  url,
  squared = false,
  ready = true,
}: {
  url: string;
  /** Drops the corner radius to 0 (theater/fullscreen fill to edges). Read
   * live in the rAF so a toggle re-rects without restarting playback. */
  squared?: boolean;
  /** Video is PRESENTING (the mpv_status first-frame signal). Until then
   * the hole stays closed — mpv opens and rects land behind the intact
   * opaque shell, so a slow tune shows the app's own black slot + tune
   * ident instead of the DESKTOP through a hole with no video behind it
   * (the first-open gap the old∩new two-phase never covered). */
  ready?: boolean;
}) {
  const fsRef = useRef(squared);
  fsRef.current = squared;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Effect keyed on `url`: a channel switch tears the player fully down
  // (cleanup inv_stop) and rebuilds after the debounce, so mpv never plays
  // a stale stream into a new channel's slot.
  useEffect(() => {
    let raf = 0;
    let opened = false;
    let last = "";
    // Set by cleanup: a move promise still in flight at teardown would
    // otherwise arm a fresh settle timer AFTER cleanup healed the hole,
    // re-cutting a see-through rectangle no component is left to heal.
    let disposed = false;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    // The settled hole (CSS px) + the two-phase timer. The video child is
    // BELOW the UI, so it only ever shows through the hole — the one fatal
    // frame is a hole with no video behind it (the desktop peeks through).
    let hole: { l: number; t: number; r: number; b: number } | null = null;
    let settleTimer = 0;
    const healHole = () => {
      if (shell) shell.style.clipPath = "";
    };
    const tick = () => {
      const el = document.getElementById(SLOT_ID);
      if (el) {
        const rect = measure(el, fsRef.current);
        // Window dims ride the key: the inverted hole's outer path needs
        // them, so a resize that somehow keeps the slot rect still re-clips.
        // Readiness rides the key: the flip to presenting must re-run the
        // cut with otherwise-unchanged geometry.
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${rect.radius},${window.innerWidth}x${window.innerHeight},${readyRef.current ? 1 : 0}`;
        if (rect.w > 0 && rect.h > 0 && key !== last) {
          last = key;
          {
            // No parking here: modals portal OUT of the shell and paint
            // above the hole, so the video keeps playing behind them —
            // the point of the whole inversion.
            //
            // The rect is VISUAL viewport px, but the clip-path on the
            // (zoomed) shell and the fixed chrome are re-multiplied by the
            // UI-scale zoom at paint — divide into pre-zoom units first,
            // or at 120% the hole lands 20% down-right of the video.
            const z = currentZoom();
            const b = el.getBoundingClientRect();
            const next = {
              l: b.left / z,
              t: b.top / z,
              r: (b.left + b.width) / z,
              b: (b.top + b.height) / z,
            };
            const rad = fsRef.current ? 0 : RADIUS_CSS;
            const W = window.innerWidth / z;
            const H = window.innerHeight / z;
            // Phase 1: clamp the hole to old∩new — the video covers that
            // overlap at every moment of the move, so nothing can peek
            // through while the native rect lands. Disjoint jump → the
            // hole closes for a frame instead.
            if (shell) {
              const ix = hole
                ? {
                    l: Math.max(hole.l, next.l),
                    t: Math.max(hole.t, next.t),
                    r: Math.min(hole.r, next.r),
                    b: Math.min(hole.b, next.b),
                  }
                : next;
              shell.style.clipPath =
                readyRef.current && ix.r > ix.l && ix.b > ix.t
                  ? holeClip(ix.l, ix.t, ix.r, ix.b, rad, W, H)
                  : "";
            }
            const move = opened
              ? tauriInvSetRect(rect)
              : ((opened = true), tauriInvOpen(url, rect));
            // Phase 2: once the native move has landed (plus a frame for
            // its present), open the full hole and snap the chrome to it.
            void move.catch(() => {}).then(() => {
              if (disposed) return;
              window.clearTimeout(settleTimer);
              settleTimer = window.setTimeout(() => {
                hole = next;
                if (shell && readyRef.current)
                  shell.style.clipPath = holeClip(
                    next.l,
                    next.t,
                    next.r,
                    next.b,
                    rad,
                    W,
                    H,
                  );
                const chrome = document.getElementById("inv-chrome");
                if (chrome) {
                  chrome.style.left = `${next.l}px`;
                  chrome.style.top = `${next.t}px`;
                  chrome.style.width = `${next.r - next.l}px`;
                  chrome.style.height = `${next.b - next.t}px`;
                }
              }, 16);
            });
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const openTimer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, OPEN_DEBOUNCE_MS);
    return () => {
      disposed = true;
      window.clearTimeout(openTimer);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      healHole();
      void tauriInvStop().catch(() => {});
    };
  }, [url]);

  return null;
}
