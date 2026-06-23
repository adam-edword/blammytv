import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** A rectangle in physical pixels — where the native mpv layer should sit. */
export interface CompRect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number; // corner radius in physical px (0 = sharp)
}

/** True when running inside the Tauri shell (vs Electron or a plain browser). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Forward a captured keyboard shortcut into the composition overlay. */
export const tauriCompKey = (key: string) =>
  invoke("comp_key", { key }) as Promise<void>;

/**
 * Open the native composition player: mpv renders into `rect` (physical px — the
 * preview box, or the full window) with the transparent overlay (TheaterOverlay)
 * composited on top. `meta` is pushed to the overlay over the postMessage bridge.
 */
export const tauriCompTheater = (
  url: string,
  meta: unknown,
  rect: CompRect,
  start = 0,
) => {
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
  }) as Promise<void>;
};

/** Move/resize the native layer to follow its in-app box (or expand to full). */
export const tauriCompSetRect = (rect: CompRect) =>
  invoke("comp_set_rect", {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    radius: rect.radius,
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
/** Fired when the overlay's fullscreen button is pressed (enter fullscreen). */
export const onCompFullscreen = (cb: () => void) =>
  onCompEvent("comp-fullscreen", cb);
/** Fired when fullscreen is exited (back to theater). */
export const onCompExitFullscreen = (cb: () => void) =>
  onCompEvent("comp-exit-fullscreen", cb);
/** Fired when the overlay's popout button is pressed. */
export const onCompPopout = (cb: () => void) => onCompEvent("comp-popout", cb);
/** Fired when the overlay's episodes/sources panel button is pressed. */
export const onCompPanel = (cb: () => void) => onCompEvent("comp-panel", cb);
/** Fired when the user closes the popout window (✕/taskbar) — bring it back. */
export const onPopoutClosed = (cb: () => void) =>
  onCompEvent("popout-closed", cb);

/** Tear down the composition player and play in mpv's own floating window (PiP). */
export const tauriCompPopout = (url: string) =>
  invoke("comp_popout", { url }) as Promise<void>;

/** Current popout playback position (seconds), to reclaim it in-app. */
export const tauriPopoutPos = () => invoke("popout_pos") as Promise<number>;

/** Close the popout window (used by the in-app "Bring it back" button). */
export const tauriPopoutStop = () => invoke("popout_stop") as Promise<void>;

/** Take the OS window in/out of true fullscreen (over the taskbar/nav). */
export const tauriSetFullscreen = (on: boolean) =>
  void getCurrentWindow()
    .setFullscreen(on)
    .catch(() => {});
