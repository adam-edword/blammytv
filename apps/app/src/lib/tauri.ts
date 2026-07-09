import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load, save } from "./storage";

/** True when running inside the Tauri shell (vs. a plain browser tab). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Dev flag: run the INVERTED player (native video parked BELOW a
 * transparent webview — the Telly arrangement, spike-proven v0.1.115)
 * instead of the comp.rs video-on-top + overlay-webview path. Toggled with
 * Ctrl+Shift+U in dev; read once at boot (main.tsx stamps .invert-player). */
export function invertedPlayer(): boolean {
  return isTauri() && load<boolean>("invertPlayer", 1, false);
}
export function setInvertedPlayer(on: boolean): void {
  save("invertPlayer", 1, on);
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
  sourceName?: string;
  /** Airing programme's start label + progress (0–100) for the LIVE bar.
   * Frozen at open time (meta is pushed once), refreshed on channel change. */
  startLabel?: string;
  progressPct?: number;
  /** Whether the channel is starred — seeds the overlay's favorite button.
   * Read at open time; the overlay tracks its own state after a toggle. */
  favorite?: boolean;
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

/** Pop the stream out into mpv's own floating window (PiP). Tears down the
 * in-app composition player first (Rust captures the position so the popout
 * resumes there), then plays in a separate mpv instance the teardown can't
 * kill. */
export function tauriCompPopout(url: string): Promise<void> {
  return invoke("comp_popout", { url });
}

/* ---- Inverted player path (inv.rs): video child at the bottom of the
 * z-order, no overlay webview — chrome is ordinary React in the main
 * webview, driving mpv through the commands below. Rects PHYSICAL px. ---- */

export function tauriInvOpen(url: string, rect: CompRect): Promise<void> {
  return invoke("inv_open", { url, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
}
export function tauriInvSetRect(rect: CompRect): Promise<void> {
  return invoke("inv_set_rect", { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
}
export function tauriInvStop(): Promise<void> {
  return invoke("inv_stop");
}

export function tauriMpvPause(paused: boolean): Promise<void> {
  return invoke("mpv_pause", { paused });
}
export function tauriMpvMute(muted: boolean): Promise<void> {
  return invoke("mpv_mute", { muted });
}
export function tauriMpvVolume(vol: number): Promise<void> {
  return invoke("mpv_volume", { vol: Math.round(vol) });
}
export function tauriMpvSeek(delta: number): Promise<void> {
  return invoke("mpv_seek", { delta });
}
export function tauriMpvGoLive(): Promise<void> {
  return invoke("mpv_go_live");
}
export function tauriMpvTrack(kind: "audio" | "sub", id: string): Promise<void> {
  return invoke("mpv_track", { kind, id });
}

/** One poll of the inverted player's status (replaces the overlay bridge's
 * loading/time/tracks pushes). `presenting` = mpv has put up a frame. */
export interface MpvStatus {
  pos: number | null;
  dur: number | null;
  presenting: boolean;
  audio: Array<{ id: number; label: string; lang: string; selected: boolean }>;
  subs: Array<{ id: number; label: string; lang: string; selected: boolean }>;
}
export async function tauriMpvStatus(): Promise<MpvStatus> {
  return JSON.parse(await invoke<string>("mpv_status")) as MpvStatus;
}

/** DEV layer-inversion spike (see spike.rs / SpikeScreen). Opens the
 * transparent test window pointed at our bundle's `?spike=1` page. */
export function tauriSpikeWindow(page: string): Promise<void> {
  return invoke("spike_window", { page });
}
/** (Re)start spike playback; `bitblt` flips mpv's present mode. */
export function tauriSpikePlay(url: string, bitblt: boolean): Promise<void> {
  return invoke("spike_play", { url, bitblt });
}
export function tauriSpikeStop(): Promise<void> {
  return invoke("spike_stop");
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

/** Forward a keyboard shortcut from the main webview into the overlay (which
 * owns the player UI + mpv control). */
export function tauriCompKey(key: string): Promise<void> {
  return invoke("comp_key", { key });
}

/** OS-window fullscreen (hides the title bar so the player fills the monitor). */
export function tauriSetFullscreen(on: boolean): Promise<void> {
  return getCurrentWindow().setFullscreen(on);
}

/** The mini → theater expand fired (overlay clicked / `t` key). */
export function onCompExpand(cb: () => void): () => void {
  return onCompEvent("comp-expand", cb);
}
/** Theater → mini collapse fired. */
export function onCompCollapse(cb: () => void): () => void {
  return onCompEvent("comp-collapse", cb);
}
/** Theater → fullscreen fired — the app should also take the OS window
 * fullscreen. */
export function onCompFullscreen(cb: () => void): () => void {
  return onCompEvent("comp-fullscreen", cb);
}
/** Fullscreen → theater fired. */
export function onCompExitFullscreen(cb: () => void): () => void {
  return onCompEvent("comp-exit-fullscreen", cb);
}
/** The overlay's PiP button fired — the app should pop the stream out. */
export function onCompPopout(cb: () => void): () => void {
  return onCompEvent("comp-popout", cb);
}
/** The overlay's favorite button fired — the app should toggle the star for
 * the playing channel. */
export function onCompFavorite(cb: () => void): () => void {
  return onCompEvent("comp-favorite", cb);
}
/** The floating PiP window was closed by the user (✕ / taskbar / q) — the app
 * should bring the stream back into the in-app player. */
export function onPopoutClosed(cb: () => void): () => void {
  return onCompEvent("popout-closed", cb);
}
