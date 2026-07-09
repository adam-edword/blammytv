import { useEffect, useRef } from "react";
import {
  invertedPlayer,
  tauriCompSetRect,
  tauriCompStop,
  tauriCompTheater,
  tauriInvOpen,
  tauriInvSetRect,
  tauriInvStop,
  type CompRect,
  type TheaterMeta,
} from "../../lib/tauri";

/* Ported from the old build's CompositionPreview — the proven driver. mpv
 * renders into a rect we push in PHYSICAL device pixels, so we measure the
 * box in CSS px and multiply by devicePixelRatio. One rAF loop diffs a
 * serialized rect key and follows the box (scroll, window/column resize,
 * layout shifts) with a single comp_set_rect per real change; the first frame
 * opens with comp_theater. A 150ms debounce means fast channel-flipping never
 * builds mpv for skipped channels. */
const OPEN_DEBOUNCE_MS = 150;
/** CSS corner radius of #player-slot — keep in sync with .hero__preview. */
const RADIUS_CSS = 12;
const SLOT_ID = "player-slot";

/** Where the native layers park while a modal covers the app (they're child
 * HWNDs above the webview, so no CSS can cover them — see App.tsx, which
 * sets `data-native-hidden` on the root). 2×2 at a negative offset instead
 * of 0×0: fully clipped by the parent window, without poking any zero-size
 * edge case in the WebView2 composition bounds. */
const PARKED: CompRect = { x: -8, y: -8, w: 2, h: 2, radius: 0 };

/** Inverted path (dev flag, inv.rs): the video child sits BELOW the webview,
 * so it only shows where nothing paints over it — the driver cuts a
 * clip-path hole through .app-shell (the flag makes the shell the window's
 * only opaque layer, see base.css) exactly at the slot. Everything else —
 * the rAF follow, the parking, the debounce — is the same driver. Parking
 * here also heals the hole, so a modal is fully opaque even mid-play. */
const INVERTED = invertedPlayer();

import { holeClip } from "./hole";

function measure(el: HTMLElement, squared: boolean): CompRect {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr),
    h: Math.round(r.height * dpr),
    // Theater/fullscreen fill to edges (square); only the mini box is rounded.
    radius: squared ? 0 : Math.round(RADIUS_CSS * dpr),
  };
}

/**
 * Headless — renders nothing. While mounted (Tauri only, with a real stream
 * URL), it opens the native mpv player into #player-slot and keeps it glued to
 * the box. Unmount tears mpv down. Re-run on `url` change rebuilds cleanly for
 * a channel switch. `meta` is read only at open time (via a ref) so a
 * programme rollover never re-opens the stream.
 */
export function CompositionPlayer({
  url,
  meta,
  squared = false,
}: {
  url: string;
  meta: TheaterMeta | null;
  /** Drops the corner radius to 0 (theater/fullscreen fill to edges). Read
   * live in the rAF so a toggle re-rects without restarting playback. */
  squared?: boolean;
}) {
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const fsRef = useRef(squared);
  fsRef.current = squared;

  // Effect keyed on `url`: a channel switch tears the player fully down
  // (cleanup comp_stop) and rebuilds after the debounce. The teardown gap is
  // load-bearing — the overlay is a WebView2 whose Close() is ASYNC, so
  // rebuilding without the gap races the close and the new overlay never
  // comes back (the video does). The black idle box covers the gap; a real
  // tightening needs Rust-side handling of the async close (can't test here).
  useEffect(() => {
    // Stash for the dev layer-spike (Ctrl+Shift+L): lets the spike window
    // play the channel that's actually on, instead of a canned test stream.
    (window as { __lastCompUrl?: string }).__lastCompUrl = url;
    let raf = 0;
    let opened = false;
    let last = "";
    const shell = INVERTED
      ? document.querySelector<HTMLElement>(".app-shell")
      : null;
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
        // Parking is comp-path-only: those native layers sit ABOVE the
        // webview, so a modal can't cover them. Inverted video is BELOW the
        // UI — modals portal out of the shell and cover it naturally.
        const parked =
          !INVERTED && document.documentElement.dataset.nativeHidden === "1";
        const rect = parked ? PARKED : measure(el, fsRef.current);
        // Window dims ride the key: the inverted hole's outer path needs
        // them, so a resize that somehow keeps the slot rect still re-clips.
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${rect.radius},${window.innerWidth}x${window.innerHeight}`;
        if (rect.w > 0 && rect.h > 0 && key !== last) {
          last = key;
          if (INVERTED) {
            // No parking here: modals portal OUT of the shell and paint
            // above the hole, so the video keeps playing behind them —
            // the point of the whole inversion.
            const b = el.getBoundingClientRect(); // hole + chrome are CSS px
            const next = {
              l: b.left,
              t: b.top,
              r: b.left + b.width,
              b: b.top + b.height,
            };
            const rad = fsRef.current ? 0 : RADIUS_CSS;
            const W = window.innerWidth;
            const H = window.innerHeight;
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
                ix.r > ix.l && ix.b > ix.t
                  ? holeClip(ix.l, ix.t, ix.r, ix.b, rad, W, H)
                  : "";
            }
            const move = opened
              ? tauriInvSetRect(rect)
              : ((opened = true), tauriInvOpen(url, rect));
            // Phase 2: once the native move has landed (plus a frame for
            // its present), open the full hole and snap the chrome to it.
            void move.catch(() => {}).then(() => {
              window.clearTimeout(settleTimer);
              settleTimer = window.setTimeout(() => {
                hole = next;
                if (shell)
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
          } else if (!opened) {
            opened = true;
            void tauriCompTheater(url, metaRef.current, rect, 0).catch(
              () => {},
            );
          } else {
            void tauriCompSetRect(rect).catch(() => {});
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const openTimer = window.setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, OPEN_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      if (INVERTED) {
        healHole();
        void tauriInvStop().catch(() => {});
      } else {
        void tauriCompStop().catch(() => {});
      }
    };
  }, [url]);

  return null;
}
