import { invoke } from "@tauri-apps/api/core";

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

/** Composition spike Step 3: native mpv under the composition webview. */
export const tauriCompTheater = (url: string) =>
  invoke("comp_theater", { url }) as Promise<void>;
