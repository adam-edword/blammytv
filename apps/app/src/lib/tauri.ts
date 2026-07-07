import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** True when running inside the Tauri shell (vs. a plain browser tab). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * The native composition player (Windows). mpv renders into a child HWND at a
 * rect we supply; a transparent overlay webview is composited on top. Rust
 * never scales, so every rect is in PHYSICAL DEVICE PIXELS — callers multiply
 * CSS px by devicePixelRatio themselves. `radius` is physical px too; `start`
 * is seconds. See src-tauri/src/comp.rs.
 */
export interface CompRect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

/** Metadata handed to the overlay (shown over the video). The wire contract
 * with the overlay webview lives here; Rust passes it through opaquely. */
export interface TheaterMeta {
  channelName: string;
  logo?: string;
  title?: string;
  description?: string;
  live?: boolean;
}

/** Open the native player: load `url` into mpv at `rect`, mounting the overlay
 * webview from our own bundle (`?overlay=1`). `start` resumes at N seconds. */
export function tauriCompTheater(
  url: string,
  meta: TheaterMeta | null,
  rect: CompRect,
  start = 0,
): Promise<void> {
  const overlayUrl = `${window.location.origin}/?overlay=1&composited=1`;
  const metaJson = meta ? JSON.stringify(meta) : "";
  return invoke("comp_theater", {
    url,
    overlayUrl,
    metaJson,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    radius: rect.radius,
    start,
  });
}

/** Move/resize the live layer to follow its in-app box. No-op if none open. */
export function tauriCompSetRect(rect: CompRect): Promise<void> {
  return invoke("comp_set_rect", {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    radius: rect.radius,
  });
}

/** Tear the player down (stop mpv, drop the overlay + child window). */
export function tauriCompStop(): Promise<void> {
  return invoke("comp_stop");
}

/** Subscribe to a native→JS composition event; returns an unsubscribe fn. */
function onCompEvent(event: string, cb: () => void): () => void {
  const un = listen(event, () => cb());
  return () => void un.then((f) => f());
}

/** The overlay's ✕ fired (mpv already stopped + layer hidden) — the app
 * should drop the player. */
export function onCompClosed(cb: () => void): () => void {
  return onCompEvent("comp-closed", cb);
}
