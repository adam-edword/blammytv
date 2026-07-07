import { useEffect, useRef } from "react";
import {
  tauriCompSetRect,
  tauriCompStop,
  tauriCompTheater,
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

function measure(el: HTMLElement): CompRect {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr),
    h: Math.round(r.height * dpr),
    radius: Math.round(RADIUS_CSS * dpr),
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
}: {
  url: string;
  meta: TheaterMeta | null;
}) {
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const rectRef = useRef<CompRect | null>(null);
  const openedRef = useRef(false);

  // Geometry loop — mounts once and follows #player-slot for the player's
  // whole life (survives channel switches). Only pushes set_rect once a
  // player is actually open. comp_stop fires only on true unmount.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const el = document.getElementById(SLOT_ID);
      if (el) {
        const rect = measure(el);
        rectRef.current = rect;
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${rect.radius}`;
        if (rect.w > 0 && rect.h > 0 && openedRef.current && key !== last) {
          last = key;
          void tauriCompSetRect(rect).catch(() => {});
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      openedRef.current = false;
      void tauriCompStop().catch(() => {});
    };
  }, []);

  // Open / switch — debounced comp_theater on the URL. Crucially it does NOT
  // tear the old player down first: the previous channel keeps playing right
  // up until the new comp_theater (which rebuilds internally), so a switch is
  // a brief rebuild gap instead of comp_stop → 150ms black → comp_theater.
  // Rapid flipping still only ever builds the channel you land on (each change
  // resets the timer).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const rect = rectRef.current;
      if (!rect || rect.w <= 0 || rect.h <= 0) return;
      void tauriCompTheater(url, metaRef.current, rect, 0).catch(() => {});
      openedRef.current = true;
    }, OPEN_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [url]);

  return null;
}
