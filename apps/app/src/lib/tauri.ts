import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** True when running inside the Tauri shell (vs. a plain browser tab). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * The native player (Windows, inv.rs). mpv renders into a child HWND at a
 * rect we supply, parked below the transparent webview. Rust never scales,
 * so every rect is in PHYSICAL DEVICE PIXELS — callers multiply CSS px by
 * devicePixelRatio themselves (radius included; it only feeds the rAF
 * change-detection key in InvertedPlayer — the DOM hole rounds itself from
 * RADIUS_CSS, and the native rect is always square).
 */
export interface CompRect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

/** Metadata shown by the player chrome over the video (TheaterOverlay). */
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

/** Pop the stream out into mpv's own floating window (PiP). Rust tears the
 * in-app player down first (one provider connection at a time) and captures
 * the position so the popout resumes there, then plays in a separate mpv
 * instance the in-app teardown can't kill. */
export function tauriPopoutOpen(url: string): Promise<void> {
  return invoke("popout_open", { url });
}

/* ---- The player (inv.rs): video child at the bottom of the z-order,
 * chrome is ordinary React in the main webview, driving mpv through the
 * commands below. Rects PHYSICAL px. ---- */

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
/** Absolute seek (seconds) — the VOD scrubber. */
export function tauriMpvSeekAbs(pos: number): Promise<void> {
  return invoke("mpv_seek_abs", { pos });
}
export function tauriMpvGoLive(): Promise<void> {
  return invoke("mpv_go_live");
}
export function tauriMpvTrack(kind: "audio" | "sub", id: string): Promise<void> {
  return invoke("mpv_track", { kind, id });
}
/** GPU frost on the whole picture (inverted path, modal open): DOM blur
 * can't sample the native video, so mpv blurs itself via a user shader. */
export function tauriMpvBlur(on: boolean): Promise<void> {
  return invoke("mpv_blur", { on });
}
/** Region frost: GPU-blur ONLY the video rectangle under a modal card —
 * live glass. Load/clear the shader once with `tauriMpvFrost` (resolves
 * FALSE when the running mpv can't do it — PARAM shaders need gpu-next —
 * so callers can downgrade the card to solid); move the rect with
 * `tauriMpvFrostRect` (pure uniform update, UI-rate safe). */
export function tauriMpvFrost(on: boolean): Promise<boolean> {
  return invoke("mpv_frost", { on });
}
export function tauriMpvFrostRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  return invoke("mpv_frost_rect", { x0, y0, x1, y1 });
}
/** One tone-mapped frame of the playing video, as a PNG blob (raw-bytes
 * IPC, same path as http_get). DORMANT — kept for future thumbnails. */
export async function tauriMpvSnapshot(): Promise<Blob> {
  const raw = await invoke<unknown>("mpv_snapshot");
  return new Blob([raw as ArrayBuffer], { type: "image/png" });
}

/** One poll of the inverted player's status (replaces the overlay bridge's
 * loading/time/tracks pushes). `presenting` = mpv has put up a frame. */
export interface MpvStatus {
  pos: number | null;
  dur: number | null;
  presenting: boolean;
  /** Mid-play death: the stream reached EOF or mpv fell back to idle. */
  ended: boolean;
  audio: Array<{ id: number; label: string; lang: string; selected: boolean }>;
  subs: Array<{ id: number; label: string; lang: string; selected: boolean }>;
}
export async function tauriMpvStatus(): Promise<MpvStatus> {
  return JSON.parse(await invoke<string>("mpv_status")) as MpvStatus;
}

/** Playback telemetry for the "stats for nerds" overlay. Every field is
 * best-effort — mpv omits any property a given stream/decoder doesn't expose,
 * so all are optional. Bitrates are bits/sec; `cache` is seconds; `videoW`/
 * `videoH` are the decoded picture size, `width`/`height` the output size. */
export interface MpvStats {
  videoCodec?: string;
  videoW?: number;
  videoH?: number;
  fps?: number;
  videoBitrate?: number;
  audioCodec?: string;
  audioBitrate?: number;
  hwdec?: string;
  dropped?: number;
  cache?: number;
  width?: number;
  height?: number;
}
export async function tauriMpvStats(): Promise<MpvStats> {
  return JSON.parse(await invoke<string>("mpv_stats")) as MpvStats;
}

/** Subscribe to a native→JS player event; returns an unsubscribe fn. */
function onUiEvent(event: string, cb: () => void): () => void {
  const un = listen(event, () => cb());
  return () => void un.then((f) => f());
}

/** OS-window fullscreen (hides the title bar so the player fills the monitor). */
export function tauriSetFullscreen(on: boolean): Promise<void> {
  return getCurrentWindow().setFullscreen(on);
}

/** The floating PiP window was closed by the user (✕ / taskbar / q) — the app
 * should bring the stream back into the in-app player. */
export function onPopoutClosed(cb: () => void): () => void {
  return onUiEvent("popout-closed", cb);
}

/** Ask GitHub Releases (via tauri-plugin-updater) whether a newer signed
 * build exists. Resolves with its version string, or null when current. */
export function tauriCheckUpdate(): Promise<string | null> {
  return invoke("check_update");
}

/** Download + install the pending update, then relaunch into it. On
 * success the app restarts and this never resolves; a rejection means the
 * download/install failed and the caller may retry. */
export function tauriInstallUpdate(): Promise<void> {
  return invoke("install_update");
}
