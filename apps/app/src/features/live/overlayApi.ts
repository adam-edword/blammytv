import type { TheaterMeta } from "../../lib/tauri";

/**
 * The player-chrome bridge contract. Two implementations:
 * - `window.overlayApi` — injected by comp.rs into the composition overlay
 *   webview (the video-on-top path);
 * - the direct api from useDirectOverlay — mpv commands + a status poll,
 *   for the inverted player's INLINE chrome in the main webview.
 */

export interface TrackEntry {
  id: number;
  label: string;
  lang: string;
  selected: boolean;
}

export interface Tracks {
  audio: TrackEntry[];
  subs: TrackEntry[];
}

export interface OverlayApi {
  close: () => void;
  setPause: (paused: boolean) => void;
  setMute: (muted: boolean) => void;
  setVolume: (vol: number) => void; // 0..100 (mpv scale)
  seek: (delta: number) => void;
  expand?: () => void; // mini → theater
  collapse?: () => void; // theater → mini
  fullscreen?: () => void; // theater → fullscreen
  exitFullscreen?: () => void; // fullscreen → theater
  popout?: () => void; // detach to mpv's floating PiP window
  toggleFavorite?: () => void; // star/unstar the playing channel
  goLive?: () => void; // reload the stream at the live edge
  setMouseIgnore: (ignore: boolean) => void;
  getMeta: () => Promise<TheaterMeta | null>;
  onMeta: (cb: (meta: TheaterMeta | null) => void) => () => void;
  getLoading: () => boolean;
  onLoading: (cb: (loading: boolean) => void) => () => void;
  onKey?: (cb: (key: string) => void) => () => void;
  selectAudio?: (id: number | string) => void; // mpv aid ("auto" ok)
  selectSub?: (id: number | string) => void; // mpv sid ("no" = off)
  getTracks?: () => Tracks | null; // SYNCHRONOUS (comp.rs bridge, like getLoading)
  onTracks?: (cb: (tracks: Tracks | null) => void) => () => void;
}

declare global {
  interface Window {
    overlayApi?: OverlayApi;
  }
}

/** Inline (inverted-player) mode: LiveScreen injects the direct
 * implementation BEFORE rendering TheaterOverlay, so its state initializers
 * (getLoading/getTracks) already read through it. Null = the real
 * `window.overlayApi` bridge. */
let apiOverride: OverlayApi | null = null;

export function setOverlayApiOverride(a: OverlayApi | null): void {
  apiOverride = a;
}

export const api = (): OverlayApi | undefined =>
  apiOverride ?? window.overlayApi;
