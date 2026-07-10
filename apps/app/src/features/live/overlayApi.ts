import type { TheaterMeta } from "../../lib/tauri";

/**
 * The player-chrome api contract. In the app there is ONE implementation:
 * the direct api from useDirectOverlay (mpv commands + a status poll),
 * injected via setOverlayApiOverride. The `window.overlayApi` fallback is a
 * TEST SEAM — scripts/verify-overlay-tracks.mjs mounts TheaterOverlay
 * standalone (`?overlay=1`) and drives it through a mocked window global.
 * (The shape is inherited from the old comp.rs overlay-webview bridge,
 * deleted at the v0.2.0 milestone.)
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

/** Playback clock for the VOD scrubber (null for live streams — mpv has
 * no meaningful duration there). */
export interface TimeInfo {
  pos: number;
  dur: number;
}

/** One chapter marker from the playing file. */
export interface ChapterInfo {
  title: string;
  start: number;
}

export interface OverlayApi {
  close: () => void;
  setPause: (paused: boolean) => void;
  setMute: (muted: boolean) => void;
  setVolume: (vol: number) => void; // 0..100 (mpv scale)
  seek: (delta: number) => void;
  seekAbs?: (pos: number) => void; // absolute seconds (VOD scrubber)
  setSpeed?: (speed: number) => void; // playback rate (VOD speed menu)
  nextSource?: () => void; // VOD failover: play the next available source
  nextEpisode?: () => void; // VOD series: jump to the next episode
  sourcePanel?: () => void; // VOD: toggle the in-playback source panel
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
  getTracks?: () => Tracks | null; // SYNCHRONOUS (like getLoading)
  onTracks?: (cb: (tracks: Tracks | null) => void) => () => void;
  getTime?: () => TimeInfo | null; // SYNCHRONOUS (like getLoading)
  onTime?: (cb: (t: TimeInfo | null) => void) => () => void;
  getChapters?: () => ChapterInfo[]; // SYNCHRONOUS (like getTracks)
  onChapters?: (cb: (c: ChapterInfo[]) => void) => () => void;
}

declare global {
  interface Window {
    overlayApi?: OverlayApi;
  }
}

/** LiveScreen injects the direct implementation BEFORE rendering
 * TheaterOverlay, so its state initializers (getLoading/getTracks) already
 * read through it. Null = fall through to `window.overlayApi` (the test
 * seam above). */
let apiOverride: OverlayApi | null = null;

export function setOverlayApiOverride(a: OverlayApi | null): void {
  apiOverride = a;
}

export const api = (): OverlayApi | undefined =>
  apiOverride ?? window.overlayApi;
