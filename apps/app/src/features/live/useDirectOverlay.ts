import { useEffect, useMemo, useRef } from "react";
import {
  tauriMpvGoLive,
  tauriMpvMute,
  tauriMpvPause,
  tauriMpvSeek,
  tauriMpvSeekAbs,
  tauriMpvSetSpeed,
  tauriMpvStatus,
  tauriMpvTrack,
  tauriMpvVolume,
  type TheaterMeta,
} from "../../lib/tauri";
import type { ChapterInfo, OverlayApi, TimeInfo, Tracks } from "./overlayApi";

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
  /** Optional go-live override. Default is mpv's re-loadfile of the same
   * URL — right for Xtream/M3U, WRONG for Stalker, whose play_token is
   * short-lived: LiveScreen re-resolves the URL there instead. */
  onGoLive?: () => void;
  /** VOD only: the file played to its END. Without this, EOF takes the
   * live-death path — watchdog reload, then a "not responding" card. */
  onEnded?: () => void;
  /** VOD only: switch to the next available source (failover). */
  onNextSource?: () => void;
  /** VOD series: jump straight to the next episode. */
  onNextEpisode?: () => void;
  /** VOD: toggle the in-playback source panel. */
  onSourcePanel?: () => void;
  /** VOD series: the clock entered (true) or left (false) an
   * ending-credits window — drives the mini Up Next popup. */
  onCreditsWindow?: (active: boolean) => void;
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
    endedFired: false,
    tracks: null as Tracks | null,
    tracksJson: "",
    metaJson: "",
    time: null as TimeInfo | null,
    chapters: [] as ChapterInfo[],
    chaptersJson: "",
    chapterCbs: new Set<(c: ChapterInfo[]) => void>(),
    metaCbs: new Set<(m: TheaterMeta | null) => void>(),
    loadingCbs: new Set<(l: boolean) => void>(),
    tracksCbs: new Set<(t: Tracks | null) => void>(),
    timeCbs: new Set<(t: TimeInfo | null) => void>(),
  }).current;

  // Meta pushes (open, channel switch, programme rollover). Hosts rebuild
  // the meta object per render, so identity alone would fan every host
  // re-render (worst: per guide hover-preview) out into a full chrome
  // re-render — compare by VALUE (the tracksJson trick) and notify only
  // on real change.
  useEffect(() => {
    metaRef.current = meta;
    const json = JSON.stringify(meta);
    if (json === s.metaJson) return;
    s.metaJson = json;
    s.metaCbs.forEach((cb) => cb(meta));
  }, [meta, s]);

  // Status poll while a stream is open; a channel switch re-arms loading.
  useEffect(() => {
    if (!active) return;
    s.loading = true;
    s.endedFired = false;
    s.tracks = null;
    s.tracksJson = "";
    s.time = null;
    s.chapters = [];
    s.chaptersJson = "";
    s.loadingCbs.forEach((cb) => cb(true));
    s.timeCbs.forEach((cb) => cb(null));
    s.chapterCbs.forEach((cb) => cb([]));
    const id = window.setInterval(() => {
      tauriMpvStatus()
        .then((st) => {
          if (s.loading && st.presenting) {
            s.loading = false;
            s.loadingCbs.forEach((cb) => cb(false));
          } else if (!s.loading && st.ended) {
            if (
              metaRef.current?.live === false &&
              (!s.time || s.time.dur <= 0 || s.time.pos >= s.time.dur * 0.9)
            ) {
              // VOD reaching EOF near the end is COMPLETION. The clock
              // guard matters: a debrid stream dying at 40% also reports
              // `ended`, and the completion path would mark it watched,
              // roll Up Next, and shred the resume position — that case
              // falls through to the death branch (VOD watchdog → dead
              // card with Retry / Try next source).
              if (!s.endedFired) {
                s.endedFired = true;
                h.current.onEnded?.();
              }
            } else {
              // Mid-play death: we were presenting, now mpv hit EOF/idle.
              // Flip loading back true so TheaterOverlay's tune watchdog
              // re-arms — live runs its silent goLive-reload escalation;
              // VOD waits its longer window then shows the dead card
              // (no auto-reload: each reload is a debrid request).
              s.loading = true;
              s.loadingCbs.forEach((cb) => cb(true));
            }
          }
          // Chapter markers (static per file — dedupe like tracks).
          const cj = JSON.stringify(st.chapters ?? []);
          if (cj !== s.chaptersJson) {
            s.chaptersJson = cj;
            s.chapters = st.chapters ?? [];
            s.chapterCbs.forEach((cb) => cb(s.chapters));
          }
          const tj = JSON.stringify([st.audio, st.subs]);
          if (tj !== s.tracksJson) {
            s.tracksJson = tj;
            s.tracks = { audio: st.audio, subs: st.subs };
            s.tracksCbs.forEach((cb) => cb(s.tracks));
          }
          // The playback clock, for the VOD scrubber. Live streams have no
          // usable duration — the overlay only renders it when dur > 0.
          if (st.pos != null && st.dur != null && st.dur > 0) {
            s.time = { pos: st.pos, dur: st.dur };
            s.timeCbs.forEach((cb) => cb(s.time));
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
      seekAbs: (p) => void tauriMpvSeekAbs(p).catch(() => {}),
      setSpeed: (sp) => void tauriMpvSetSpeed(sp).catch(() => {}),
      nextSource: () => h.current.onNextSource?.(),
      nextEpisode: () => h.current.onNextEpisode?.(),
      sourcePanel: () => h.current.onSourcePanel?.(),
      creditsWindow: (active) => h.current.onCreditsWindow?.(active),
      selectAudio: (id) =>
        void tauriMpvTrack("audio", String(id)).catch(() => {}),
      selectSub: (id) => void tauriMpvTrack("sub", String(id)).catch(() => {}),
      expand: () => h.current.onExpand(),
      collapse: () => h.current.onCollapse(),
      fullscreen: () => h.current.onFullscreen(),
      exitFullscreen: () => h.current.onExitFullscreen(),
      popout: () => h.current.onPopout(),
      toggleFavorite: () => h.current.onToggleFavorite(),
      goLive: () => {
        if (h.current.onGoLive) h.current.onGoLive();
        else void tauriMpvGoLive().catch(() => {});
      },
      setMouseIgnore: () => {}, // real DOM above the video — clicks just work
      getMeta: () => Promise.resolve(metaRef.current),
      onMeta: sub(s.metaCbs),
      getLoading: () => s.loading,
      onLoading: sub(s.loadingCbs),
      onKey: () => () => {}, // the overlay's own document listener covers keys
      getTracks: () => s.tracks,
      onTracks: sub(s.tracksCbs),
      getTime: () => s.time,
      onTime: sub(s.timeCbs),
      getChapters: () => s.chapters,
      onChapters: sub(s.chapterCbs),
    };
  }, [s]);
}
