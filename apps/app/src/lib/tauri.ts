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

/**
 * The native Android player bridge, injected by MainActivity via
 * addJavascriptInterface. Present only in the Android build — on Windows the
 * player is the DirectComposition/mpv path below, so this is undefined there.
 */
interface NativePlayer {
  /** Load fullscreen (VOD). */
  load(url: string, metaJson: string, startSeconds: number): void;
  /** Load into the mini surface at a physical-px rect (live). */
  loadAt(
    url: string,
    metaJson: string,
    startSeconds: number,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): void;
  /** Keep the mini surface aligned to its (moving) web box. */
  setRect(x: number, y: number, w: number, h: number, radius: number): void;
  /** Tap the mini → fullscreen; native Back collapses back to mini. */
  setFullscreen(fs: boolean): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
}
declare global {
  interface Window {
    BlammyNativePlayer?: NativePlayer;
  }
}
const nativePlayer = (): NativePlayer | undefined =>
  typeof window !== "undefined" ? window.BlammyNativePlayer : undefined;

/** True when running on the native Android player (the bridge is injected). */
export const isNativePlayer = (): boolean => !!nativePlayer();

/**
 * Fired when the native Android player closes itself (the Back button) — React
 * should drop its player route and return to browsing. The native side
 * dispatches a `blammy-native-close` window event over the JS bridge.
 */
export const onNativeClose = (cb: () => void): (() => void) => {
  const handler = () => cb();
  window.addEventListener("blammy-native-close", handler);
  return () => window.removeEventListener("blammy-native-close", handler);
};

/**
 * Fired periodically by the native Android player with the current playback
 * position + total duration (seconds) — used to keep Continue Watching progress
 * up to date. Dispatched as a `blammy-native-progress` CustomEvent.
 */
export const onNativeProgress = (
  cb: (position: number, duration: number) => void,
): (() => void) => {
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as
      | { position?: number; duration?: number }
      | undefined;
    if (d && typeof d.position === "number" && typeof d.duration === "number") {
      cb(d.position, d.duration);
    }
  };
  window.addEventListener("blammy-native-progress", handler);
  return () => window.removeEventListener("blammy-native-progress", handler);
};

/**
 * Fired when the native Android player collapses fullscreen back to the mini
 * surface (its Back button) — React drops theater mode; the mini keeps playing.
 */
export const onNativeCollapse = (cb: () => void): (() => void) => {
  const handler = () => cb();
  window.addEventListener("blammy-native-collapse", handler);
  return () => window.removeEventListener("blammy-native-collapse", handler);
};

/** On-device LAN setup server ("configure from another device"). Returns the
 * LAN address + a one-time token for the TV to display as a URL/QR. */
export const startConfigServer = () =>
  invoke("config_server_start") as Promise<{
    ip: string;
    port: number;
    token: string;
  }>;

export const stopConfigServer = () =>
  invoke("config_server_stop") as Promise<void>;

/** Fires when the setup form (filled in on a phone/laptop) submits — the payload
 * is the raw JSON the browser posted. */
export const onConfigReceived = (
  cb: (json: string) => void,
): (() => void) => {
  const un = listen<string>("config-received", (e) => cb(e.payload));
  return () => void un.then((f) => f());
};

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
  // Android: drive the native ExoPlayer bridge instead of the Windows
  // DirectComposition path. Forward the chrome fields (clearlogo + the three
  // text lines) so the custom controller can render them, and load into the mini
  // surface at the hero-box rect — the rAF loop (setRect) keeps it aligned, and a
  // tap (setFullscreen) expands it.
  const np = nativePlayer();
  if (np) {
    const m = (meta ?? {}) as {
      logo?: string;
      channelName?: string;
      title?: string;
      description?: string;
    };
    const payload = JSON.stringify({
      logo: m.logo,
      line: m.channelName,
      title: m.title,
      subtitle: m.description,
    });
    np.loadAt(url, payload, start, rect.x, rect.y, rect.w, rect.h, rect.radius);
    return Promise.resolve();
  }
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
export const tauriCompSetRect = (rect: CompRect) => {
  // Android: keep the mini surface aligned to the web box (no-op while it's
  // fullscreen — the native side ignores it then).
  const np = nativePlayer();
  if (np) {
    np.setRect(rect.x, rect.y, rect.w, rect.h, rect.radius);
    return Promise.resolve();
  }
  return invoke("comp_set_rect", {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    radius: rect.radius,
  }) as Promise<void>;
};

/** Expand the mini player to fullscreen (or collapse it). Android only — the
 * desktop drives fullscreen through the overlay's own events. */
export const tauriCompFullscreen = (fs: boolean) => {
  const np = nativePlayer();
  if (np) np.setFullscreen(fs);
  return Promise.resolve();
};

/** Tear down the native composition player and free the window. */
export const tauriCompStop = () => {
  const np = nativePlayer();
  if (np) {
    np.stop();
    return Promise.resolve();
  }
  return invoke("comp_stop") as Promise<void>;
};

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
