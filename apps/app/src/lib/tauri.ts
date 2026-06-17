import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A rectangle in physical pixels — where the native mpv layer should sit. */
export interface CompRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when running inside the Tauri shell (vs Electron or a plain browser). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Milestone 1: play a stream in mpv's own window via the Rust shell. */
export const tauriMpvPlay = (url: string) =>
  invoke("mpv_play", { url }) as Promise<void>;
export const tauriMpvSetPause = (paused: boolean) =>
  invoke("mpv_set_pause", { paused }) as Promise<void>;
export const tauriMpvStop = () => invoke("mpv_stop") as Promise<void>;

/** Composition spike Step 1: composite a blue GPU layer over the window. */
export const tauriCompColorTest = () =>
  invoke("comp_color_test") as Promise<void>;

/** Composition spike Step 2: a transparent composition WebView2 over the layer. */
export const tauriCompWebviewTest = () =>
  invoke("comp_webview_test") as Promise<void>;

/** Diagnostic: mpv embedded in a bare child window (no DComp / webview). */
export const tauriCompMpvChild = (url: string) =>
  invoke("comp_mpv_child", { url }) as Promise<void>;

/**
 * Open the native composition player: mpv renders into `rect` (physical px — the
 * preview box, or the full window) with the transparent overlay (TheaterOverlay)
 * composited on top. `meta` is pushed to the overlay over the postMessage bridge.
 */
export const tauriCompTheater = (url: string, meta: unknown, rect: CompRect) => {
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
  }) as Promise<void>;
};

/** Move/resize the native layer to follow its in-app box (or expand to full). */
export const tauriCompSetRect = (rect: CompRect) =>
  invoke("comp_set_rect", {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
  }) as Promise<void>;

/** Tear down the native composition player and free the window. */
export const tauriCompStop = () => invoke("comp_stop") as Promise<void>;

const onCompEvent = (event: string, cb: () => void): (() => void) => {
  const un = listen(event, () => cb());
  return () => void un.then((f) => f());
};

/** Fired when the overlay's ✕ closes the native player — drop back to the guide. */
export const onCompClosed = (cb: () => void) => onCompEvent("comp-closed", cb);
/** Fired when the mini preview is clicked — enter theater (fullscreen) mode. */
export const onCompExpand = (cb: () => void) => onCompEvent("comp-expand", cb);
/** Fired when theater is exited — collapse back to the mini preview. */
export const onCompCollapse = (cb: () => void) =>
  onCompEvent("comp-collapse", cb);
