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

/** Full-viewport ring with a rectangular cutout at CSS-px rect (l,t,r,b). */
const holeClip = (l: number, t: number, r: number, b: number) =>
  `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
  `${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px)`;

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
    const healHole = () => {
      if (shell) shell.style.clipPath = "";
    };
    const tick = () => {
      const el = document.getElementById(SLOT_ID);
      if (el) {
        const parked = document.documentElement.dataset.nativeHidden === "1";
        const rect = parked ? PARKED : measure(el, fsRef.current);
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${rect.radius}`;
        if (rect.w > 0 && rect.h > 0 && key !== last) {
          last = key;
          if (INVERTED) {
            if (parked) healHole();
            else if (shell) {
              const r = el.getBoundingClientRect(); // hole is CSS px
              shell.style.clipPath = holeClip(
                r.left,
                r.top,
                r.left + r.width,
                r.top + r.height,
              );
            }
            if (!opened) {
              opened = true;
              void tauriInvOpen(url, rect).catch(() => {});
            } else {
              void tauriInvSetRect(rect).catch(() => {});
            }
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
