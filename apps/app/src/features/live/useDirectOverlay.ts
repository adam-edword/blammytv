import { useEffect, useMemo, useRef } from "react";
import {
  tauriMpvGoLive,
  tauriMpvMute,
  tauriMpvPause,
  tauriMpvSeek,
  tauriMpvStatus,
  tauriMpvTrack,
  tauriMpvVolume,
  type TheaterMeta,
} from "../../lib/tauri";
import type { OverlayApi, Tracks } from "./overlayApi";

/** The window verbs (expand/collapse/fullscreen/…) — plain callbacks into
 * LiveScreen's state. Read through a ref at call time, so the returned api
 * can stay one stable object. */
export interface DirectOverlayHandlers {
  onClose: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onFullscreen: () => void;
  onExitFullscreen: () => void;
  onPopout: () => void;
  onToggleFavorite: () => void;
}

/**
 * The inline OverlayApi for the player chrome: backed by direct mpv
 * commands plus a 500ms `mpv_status` poll — loading flips false on mpv's
 * first presented frame (core-idle), and the track lists push on change.
 * (The contract is the one the old comp.rs overlay-webview bridge defined;
 * the shape survived the v0.2.0 deletion so TheaterOverlay didn't have to
 * change.) `resetKey` (the stream URL) re-arms loading on every channel
 * switch.
 */
export function useDirectOverlay(
  active: boolean,
  resetKey: string | null,
  meta: TheaterMeta | null,
  handlers: DirectOverlayHandlers,
): OverlayApi {
  const h = useRef(handlers);
  h.current = handlers;
  const metaRef = useRef(meta);
  const s = useRef({
    loading: true,
    tracks: null as Tracks | null,
    tracksJson: "",
    metaCbs: new Set<(m: TheaterMeta | null) => void>(),
    loadingCbs: new Set<(l: boolean) => void>(),
    tracksCbs: new Set<(t: Tracks | null) => void>(),
  }).current;

  // Meta pushes (open, channel switch, programme rollover).
  useEffect(() => {
    metaRef.current = meta;
    s.metaCbs.forEach((cb) => cb(meta));
  }, [meta, s]);

  // Status poll while a stream is open; a channel switch re-arms loading.
  useEffect(() => {
    if (!active) return;
    s.loading = true;
    s.tracks = null;
    s.tracksJson = "";
    s.loadingCbs.forEach((cb) => cb(true));
    const id = window.setInterval(() => {
      tauriMpvStatus()
        .then((st) => {
          if (s.loading && st.presenting) {
            s.loading = false;
            s.loadingCbs.forEach((cb) => cb(false));
          } else if (!s.loading && st.ended) {
            // Mid-play death: we were presenting, now mpv hit EOF/idle. Flip
            // loading back true so TheaterOverlay's tune watchdog re-arms and
            // runs its silent goLive-reload escalation (then the dead card).
            s.loading = true;
            s.loadingCbs.forEach((cb) => cb(true));
          }
          const tj = JSON.stringify([st.audio, st.subs]);
          if (tj !== s.tracksJson) {
            s.tracksJson = tj;
            s.tracks = { audio: st.audio, subs: st.subs };
            s.tracksCbs.forEach((cb) => cb(s.tracks));
          }
        })
        .catch(() => {});
    }, 500);
    return () => window.clearInterval(id);
  }, [active, resetKey, s]);

  return useMemo<OverlayApi>(() => {
    const sub =
      <T,>(set: Set<(v: T) => void>) =>
      (cb: (v: T) => void) => {
        set.add(cb);
        return () => {
          set.delete(cb);
        };
      };
    return {
      close: () => h.current.onClose(),
      setPause: (p) => void tauriMpvPause(p).catch(() => {}),
      setMute: (m) => void tauriMpvMute(m).catch(() => {}),
      setVolume: (v) => void tauriMpvVolume(v).catch(() => {}),
      seek: (d) => void tauriMpvSeek(d).catch(() => {}),
      selectAudio: (id) =>
        void tauriMpvTrack("audio", String(id)).catch(() => {}),
      selectSub: (id) => void tauriMpvTrack("sub", String(id)).catch(() => {}),
      expand: () => h.current.onExpand(),
      collapse: () => h.current.onCollapse(),
      fullscreen: () => h.current.onFullscreen(),
      exitFullscreen: () => h.current.onExitFullscreen(),
      popout: () => h.current.onPopout(),
      toggleFavorite: () => h.current.onToggleFavorite(),
      goLive: () => void tauriMpvGoLive().catch(() => {}),
      setMouseIgnore: () => {}, // real DOM above the video — clicks just work
      getMeta: () => Promise.resolve(metaRef.current),
      onMeta: sub(s.metaCbs),
      getLoading: () => s.loading,
      onLoading: sub(s.loadingCbs),
      onKey: () => () => {}, // the overlay's own document listener covers keys
      getTracks: () => s.tracks,
      onTracks: sub(s.tracksCbs),
    };
  }, [s]);
}
