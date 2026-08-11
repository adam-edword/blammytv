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
import {
  holdsPoll,
  nextHold,
  nextHoldAbs,
  type SeekHold,
} from "./seekHold";
import {
  behindLive,
  nextBaseline,
  type EdgeBaseline,
} from "./liveEdge";
import { dvrChanged, dvrWindow, type DvrWindow } from "./dvr";
import { endDecision } from "./ending";

/**
 * Status cadence once a picture is up. The scrubber clock and the death
 * detector both ride this, and plan 012 measured it at 0.36ms native and
 * 0.08% of one core, so it is not worth making cheaper.
 */
const POLL_MS = 500;
/**
 * Status cadence while something is LOADING.
 *
 * The whole cost of this is that a tune takes a second or two, so ten reads
 * at ~2.5ms of IPC each is a few percent of one core for that window and
 * nothing afterwards. What it buys is the quarter second of black that a
 * 500ms grid was adding to the average channel switch, because `presenting`
 * cannot be noticed sooner than the next tick.
 */
const TUNE_POLL_MS = 100;

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
  /** Switch to the next available source (failover). Providing this is
   * what tells the overlay a source LIST exists: it auto-steps on a dead
   * stream and offers the manual button. VOD's stepping is additionally
   * gated on a setting, because a debrid retry costs a request. */
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
    /**
     * The last position mpv ACTUALLY reported, never held.
     *
     * `time` is what the chrome draws, and the seek hold deliberately freezes
     * it so a stale poll cannot yank the scrubber back. Decisions about
     * whether a file COMPLETED must not read a frozen value: seek from 95% to
     * 10%, have the source die inside the 1.5s hold, and the completion test
     * `pos >= dur * 0.9` was still looking at 95%. That fires onEnded on a
     * death — markWatched, the watch entry pushed to dur/dur, Up Next rolling
     * the next episode, and the real resume position gone. Which is verbatim
     * the failure the guard below exists to prevent; the hold reintroduced it
     * through the back door by making `time` untrustworthy exactly when a
     * death is most likely (a fresh range request is in flight).
     *
     * Same fix covers the other direction: hold an arrow key and the throttle
     * re-stamps the hold every 150ms, so it never expires and `time` sat at
     * the pre-burst position while mpv ran to EOF. A finished file then took
     * the DEATH path and showed "isn't responding" instead of Up Next.
     */
    lastTime: null as TimeInfo | null,
    seekHold: null as SeekHold | null,
    buffering: false,
    seekable: true,
    /** demuxer-cache-duration while known to be AT the live edge. Set once
     * per stream, on the first reading after the picture is up. */
    edgeBaseline: null as EdgeBaseline | null,
    /** performance.now() of the first presented frame, for the settle window. */
    presentedAt: 0,
    /** The user has seeked on this stream, so the baseline stops refining. */
    seeked: false,
    behind: 0,
    behindCbs: new Set<(sec: number) => void>(),
    dvr: null as DvrWindow | null,
    dvrCbs: new Set<(w: DvrWindow | null) => void>(),
    bufferingCbs: new Set<(b: boolean) => void>(),
    seekableCbs: new Set<(s: boolean) => void>(),
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
    s.buffering = false;
    s.seekable = true;
    s.edgeBaseline = null;
    s.presentedAt = 0;
    s.seeked = false;
    s.behind = 0;
    s.dvr = null;
    s.tracks = null;
    s.tracksJson = "";
    s.time = null;
    s.lastTime = null;
    // MISSED when the hold landed, alongside eleven fields that are reset
    // here. A stream change with a hold up measured the NEW file's first
    // positions against the OLD file's target, discarding them for up to
    // 1.5s — so a fast episode roll, a failover or a Retry each parked the
    // scrubber at 0:00 for a beat.
    s.seekHold = null;
    s.chapters = [];
    s.chaptersJson = "";
    s.loadingCbs.forEach((cb) => cb(true));
    s.timeCbs.forEach((cb) => cb(null));
    s.chapterCbs.forEach((cb) => cb([]));
    // PUSH the cleared window, do not just clear it. `dvrChanged(null, null)`
    // is false, so the poll's own gate can never announce this — and the
    // overlay is not remounted on a channel switch (LiveScreen renders it
    // with no key). Without this the chrome kept the PREVIOUS channel's
    // window: a rail drawn from a frozen percentage, still draggable, whose
    // release seeked to an absolute second on the old channel's timeline.
    s.dvrCbs.forEach((cb) => cb(null));
    /**
     * SELF-CHAINED, not setInterval, and the delay is chosen per tick.
     *
     * `presenting` is how the app learns the first frame landed: it opens the
     * clip hole and dismisses the tune card. mpv presents at some arbitrary
     * point between two ticks, so at a flat 500ms every channel switch and
     * every VOD start carried a uniform 0-500ms of extra black, 250ms on
     * average, on top of whatever mpv actually took. It also polluted the one
     * number this project has been navigating by: plan 012 read a ~1.3s
     * first-frame floor and asked how much of it was ours. Up to 500ms of it
     * was this timer.
     *
     * So it runs at TUNE_POLL_MS while something is loading and drops back to
     * POLL_MS once the picture is up. The fast rate only exists during a tune,
     * a second or two, and buys back most of that quarter second.
     *
     * NOT a faster poll in general. Plan 012 declined that, and correctly, but
     * it declined it for SCRUBBER GRANULARITY on the reasoning that the drag
     * is already smooth. Channel-switch latency was never the question being
     * asked, and the IPC cost it weighed (~2.5ms a call from JS) is only paid
     * here for the duration of a load rather than for the whole session.
     *
     * Chained rather than fixed-interval so a slow call can never stack: the
     * next tick is scheduled once the previous one has settled.
     */
    let timer = 0;
    let stopped = false;
    const tick = () => {
      tauriMpvStatus()
        .then((st) => {
          // FINISHED or DIED — the most expensive question here, and the
          // one with two shipped regressions behind it. The decision lives
          // in ending.ts as a tested pure function; this is only the wiring.
          // `lastTime`, never `time`: the displayed clock is deliberately
          // held across a seek and is the wrong input for something that can
          // destroy a resume position.
          switch (
            endDecision({
              loading: s.loading,
              presenting: st.presenting,
              ended: st.ended,
              vod: metaRef.current ? metaRef.current.live === false : undefined,
              time: s.lastTime,
            })
          ) {
            case "present":
              s.presentedAt = performance.now();
              s.loading = false;
              s.loadingCbs.forEach((cb) => cb(false));
              break;
            case "complete":
              // Once per stream. The reset block clears the latch.
              if (!s.endedFired) {
                s.endedFired = true;
                h.current.onEnded?.();
              }
              break;
            case "rearm":
              // Mid-play death: we were presenting, now mpv hit EOF/idle.
              // Flip loading back true so TheaterOverlay's tune watchdog
              // re-arms — live runs its silent goLive-reload escalation;
              // VOD waits its longer window then shows the dead card
              // (no auto-reload: each reload is a debrid request).
              s.loading = true;
              s.loadingCbs.forEach((cb) => cb(true));
              break;
          }
          // The natural forward buffer, refined over the first seconds. The
          // DVR window's live edge is derived from it, so it has to come
          // first. See liveEdge.
          s.edgeBaseline = nextBaseline(s.edgeBaseline, {
            loading: s.loading,
            cacheDur: st.cacheDur,
            sincePresent: s.presentedAt ? performance.now() - s.presentedAt : 0,
            seeked: s.seeked,
          });
          // The live DVR window. Null until the baseline settles, because a
          // window built on a wrong gap is worse than no window.
          const win = dvrWindow(
            st.dvrStart,
            st.dvrEnd,
            st.pos,
            s.edgeBaseline && !s.edgeBaseline.settling ? s.edgeBaseline.gap : null,
          );
          if (dvrChanged(s.dvr, win)) {
            s.dvr = win;
            s.dvrCbs.forEach((cb) => cb(win));
          }
          // Fallback for a host with no window: the same baseline, read as a
          // distance rather than a position.
          const beh = behindLive(st.cacheDur, s.edgeBaseline?.gap ?? null);
          if (Math.abs(beh - s.behind) > 0.5) {
            s.behind = beh;
            s.behindCbs.forEach((cb) => cb(beh));
          }
          // Buffering and seekability, both plain edge-triggered pushes.
          // `buffering` is kept well away from `s.loading`: see the note on
          // getBuffering in overlayApi. Older Rust builds omit both fields,
          // and `undefined` reads as not-buffering / seekable, which is the
          // pre-existing behaviour exactly.
          const buf = !!st.buffering;
          if (buf !== s.buffering) {
            s.buffering = buf;
            s.bufferingCbs.forEach((cb) => cb(buf));
          }
          const skb = st.seekable !== false;
          if (skb !== s.seekable) {
            s.seekable = skb;
            s.seekableCbs.forEach((cb) => cb(skb));
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
            // Unconditional, and BEFORE the hold: this is what mpv said, which
            // is what the completion test needs. The hold only governs what
            // the chrome is shown.
            s.lastTime = { pos: st.pos, dur: st.dur };
            // Unless a seek is still in flight and this is the position it
            // was seeking AWAY from. See seekHold.
            if (holdsPoll(s.seekHold, st.pos, performance.now())) {
              // Discard: the chrome's optimistic position stands.
            } else {
              s.seekHold = null;
              s.time = { pos: st.pos, dur: st.dur };
              s.timeCbs.forEach((cb) => cb(s.time));
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (stopped) return;
          timer = window.setTimeout(tick, s.loading ? TUNE_POLL_MS : POLL_MS);
        });
    };
    // First read at the tune rate: `s.loading` is true from a few lines
    // above, which is exactly the window this is for.
    timer = window.setTimeout(tick, TUNE_POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [active, resetKey, s]);

  // Whether the HOST has a source list at all. A capability, not state:
  // no host grows or loses one mid-playback, so it is read once and the
  // api object stays the single stable identity the overlay depends on.
  const hasNext = !!handlers.onNextSource;

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
      // Both arm the hold, so the poll cannot push the pre-seek position
      // back over the chrome's optimistic one. Only for VOD: `s.time` is
      // null on live (no usable duration), and there is no scrubber to
      // protect. A relative seek's target is exact because mpv is asked for
      // `relative+exact`, so aiming at pos + delta is aiming at where it
      // will actually land.
      // Both arm the hold so the poll cannot push the pre-seek position back
      // over the chrome's optimistic one. The target maths lives in seekHold
      // because it has a regression history; this is only the wiring.
      seek: (d) => {
        s.seeked = true;
        s.seekHold = nextHold(s.seekHold, s.time, s.seekable, d, performance.now());
        void tauriMpvSeek(d).catch(() => {});
      },
      seekAbs: (p) => {
        s.seeked = true;
        s.seekHold = nextHoldAbs(s.time, s.seekable, p, performance.now());
        void tauriMpvSeekAbs(p).catch(() => {});
      },
      setSpeed: (sp) => void tauriMpvSetSpeed(sp).catch(() => {}),
      // PRESENT ONLY IF THE HOST OFFERS ONE, because its presence is the
      // question the dead card asks before drawing a "try the next source"
      // button. Bound to a handler that might be undefined, it was always
      // truthy and always answered yes, so the button had to be gated on
      // "is this VOD" instead — which is not the same question, and is why
      // a live host with a real source list could not show it.
      nextSource: hasNext ? () => h.current.onNextSource?.() : undefined,
      nextEpisode: () => h.current.onNextEpisode?.(),
      sourcePanel: () => h.current.onSourcePanel?.(),
      creditsWindow: (active) => h.current.onCreditsWindow?.(active),
      // CLEAR THE DEDUPE KEY, or a rejected switch is invisible forever.
      // The chrome flips its checkmark optimistically and relies on this
      // poll to correct it if mpv refused the track (a sub codec it can't
      // initialise, a stale id on a churned list). But the poll only pushes
      // when the track JSON DIFFERS from the last push, and a refusal
      // leaves mpv's `selected` flags exactly as they were — so the JSON is
      // identical, nothing pushes, and the optimistic checkmark is never
      // contradicted. On VOD it is worse than a wrong tick: the pick is
      // written to the per-show memory and re-applied, and re-refused, on
      // every following episode. Blanking the key forces the next tick to
      // re-push mpv's actual answer, confirming or correcting within one
      // poll. Here rather than in the chrome so all three hosts get it.
      selectAudio: (id) => {
        s.tracksJson = "";
        void tauriMpvTrack("audio", String(id)).catch(() => {});
      },
      selectSub: (id) => {
        s.tracksJson = "";
        void tauriMpvTrack("sub", String(id)).catch(() => {});
      },
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
      // Read the ref AT RESOLUTION, not at call: the overlay calls this in
      // its mount effect, BEFORE this hook's meta effect has stored the
      // first meta — a call-time capture resolves null after the real push
      // and clobbers it (first-playback-of-session live-chrome bug).
      getMeta: () => Promise.resolve().then(() => metaRef.current),
      onMeta: sub(s.metaCbs),
      getLoading: () => s.loading,
      onLoading: sub(s.loadingCbs),
      getBuffering: () => s.buffering,
      onBuffering: sub(s.bufferingCbs),
      getSeekable: () => s.seekable,
      onSeekable: sub(s.seekableCbs),
      getBehindLive: () => s.behind,
      onBehindLive: sub(s.behindCbs),
      getDvr: () => s.dvr,
      onDvr: sub(s.dvrCbs),
      onKey: () => () => {}, // the overlay's own document listener covers keys
      getTracks: () => s.tracks,
      onTracks: sub(s.tracksCbs),
      getTime: () => s.time,
      onTime: sub(s.timeCbs),
      getChapters: () => s.chapters,
      onChapters: sub(s.chapterCbs),
    };
  }, [s, hasNext]);
}
