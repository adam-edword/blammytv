import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri, type TheaterMeta } from "../../lib/tauri";
import { api, type ChapterInfo, type TimeInfo, type Tracks } from "./overlayApi";
import {
  loadOverlayMeta,
  onOverlayMetaChange,
  overlayHeading,
  type OverlayMetaField,
} from "../settings/overlayMeta";
import { loadSourceFailover } from "../settings/failover";
import {
  loadPlaybackPrefs,
  matchTrack,
  rememberPlayback,
} from "../settings/playbackPrefs";
import {
  loadSkipBehavior,
  onSkipBehaviorChange,
  type SkipBehavior,
} from "../settings/skipBehavior";
import { StatsOverlay } from "./StatsOverlay";
import {
  CcIcon,
  CheckIcon,
  CloseIcon,
  NextEpisodeIcon,
  PanelIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  LanguageIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  PopoutIcon,
  RainbowStarIcon,
  SkipBackIcon,
  SkipFwdIcon,
  StarIcon,
  StatsIcon,
  VolumeIcon,
} from "../../ui/icons";

/**
 * The on-video player chrome, rendered INLINE in the main webview (portaled
 * into #inv-chrome over the clip hole — the video child sits below the
 * webview, see inv.rs). Controls drive mpv through the api() from
 * useDirectOverlay: plain Tauri mpv_* commands + a 500ms status poll.
 *
 * Three states: MINI (small — play/pause + ✕ + click-to-expand), THEATER
 * (large windowed — full auto-hiding chrome), FULLSCREEN (fills the monitor —
 * same chrome). Inline, LiveScreen passes the state it owns via the `frame`
 * prop; without one (only the `?overlay=1` TEST HARNESS route, a leftover of
 * the deleted comp.rs overlay webview kept for verify-overlay-tracks.mjs)
 * the state is inferred from the window size. Live-only (no VOD seek/speed).
 */

/** True when the overlay fills (nearly) the whole monitor — i.e. fullscreen. */
const atFullscreen = () => window.innerWidth >= window.screen.width * 0.95;
/** The mini box is uniquely short (≈278px, 494×16:9); theater fills the main
 * content area and fullscreen the monitor, both far taller. Keying mini off
 * height (not width) survives a narrow window where the theater fill is also
 * narrow. */
const isMini = () => window.innerHeight < 450;

/** Player size state. In the overlay webview it's inferred from the window
 * (the webview IS the player box); rendered inline (inverted player) the
 * window is the whole app, so LiveScreen passes the state it owns. */
export type OverlayFrame = "mini" | "theater" | "fullscreen";

/** Chapter titles worth a Skip button. Deliberately conservative — a
 * false "Skip Intro" over real content is worse than a missing one. */
const SKIP_RX =
  /\b(intro|opening|op|recap|previously|credits|ending|ed|outro|preview)\b/i;
const CREDITS_RX = /credits|ending|outro|\bed\b/i;
const PREVIEW_RX = /preview/i;
function skipLabel(title: string): string {
  if (/recap|previously/i.test(title)) return "Skip Recap";
  if (/credits|ending|outro|\bed\b/i.test(title)) return "Skip Credits";
  if (/preview/i.test(title)) return "Skip Preview";
  return "Skip Intro";
}

/** AniSkip type → chip label (op/ed/mixed-op/mixed-ed/recap). */
function remoteSkipLabel(type: string): string {
  if (type === "recap") return "Skip Recap";
  if (type.endsWith("ed")) return "Skip Credits";
  return "Skip Intro";
}

/** "1:23" / "12:34" / "1:02:07" — hours only when they exist. */
function fmtClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function TheaterOverlay({
  frame,
  playbackKey,
  vod: vodProp,
}: {
  frame?: OverlayFrame;
  /** Inline mode: changes when the stream does. The overlay webview was
   * rebuilt per channel, so its state reset for free — inline, the same
   * component instance survives the switch and must resync itself. */
  playbackKey?: string | null;
  /** Chrome mode, declared BY THE HOST. The hosts know statically what
   * they play (StreamScreen = VOD, LiveScreen = live) — inferring this
   * from bridge meta meant any hiccup in meta delivery flipped a VOD
   * into live chrome (LIVE pill, pegged bar, no scrubber) and skipped
   * the subtitle-prefs apply. Meta remains the fallback only for the
   * legacy overlay-webview entry (main.tsx), which has no host. */
  vod?: boolean;
} = {}) {
  const [meta, setMeta] = useState<TheaterMeta | null>(null);
  const metaRefForDead = useRef<TheaterMeta | null>(null);
  metaRefForDead.current = meta;
  const [loading, setLoading] = useState(() => api()?.getLoading() ?? true);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Live-edge position (%). Full = at the live edge; seeking back walks it
  // left, forward walks it toward live. mpv exposes no live position for a
  // live stream, so this is a client-side indicator that tracks the seeks.
  const [livePct, setLivePct] = useState(100);
  const [active, setActive] = useState(true); // chrome shown (auto-hides)
  // Window-heuristic size state (overlay-webview mode). Inline, `frame`
  // wins DERIVED IN RENDER — routing it through state + an effect painted
  // one frame of the old layout inside the new box on every transition.
  const [miniState, setMiniState] = useState(isMini);
  const [fsState, setFsState] = useState(atFullscreen);
  const mini = frame ? frame === "mini" : miniState;
  const fs = frame ? frame === "fullscreen" : fsState;
  // Live frame reads for the key handlers (props go stale in stable
  // callbacks; the window heuristics stay the overlay-webview fallback).
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const miniNow = useCallback(
    () => (frameRef.current ? frameRef.current === "mini" : isMini()),
    [],
  );
  const fsNow = useCallback(
    () => (frameRef.current ? frameRef.current === "fullscreen" : atFullscreen()),
    [],
  );
  // Favorite is seeded from meta at open/channel-change, then owned locally so a
  // click flips instantly (the main app persists the real list via the bridge).
  const [fav, setFav] = useState(false);
  // Audio/sub tracks, seeded sync from the bridge cache then pushed on change.
  const [tracks, setTracks] = useState<Tracks | null>(
    () => api()?.getTracks?.() ?? null,
  );
  // New file = new track list, but the bridge only pushes it a poll later.
  // Drop the stale list IN RENDER (before effects fire), or the VOD apply
  // effect below would burn its once-per-key guard matching remembered
  // languages against the PREVIOUS episode's tracks — and then skip the
  // real list when it lands, resetting subs at every episode boundary.
  // (The bridge resets its dedupe json on the same URL change, so the
  // fresh list always re-pushes even when it's identical.)
  const [tracksKey, setTracksKey] = useState(playbackKey);
  if (playbackKey !== tracksKey) {
    setTracksKey(playbackKey);
    setTracks(null);
  }
  const [menu, setMenu] = useState<"audio" | "subs" | "speed" | null>(null);
  // Stats-for-nerds panel (theater/fullscreen only). Telemetry comes straight
  // from the mpv_stats Tauri command, so it's gated on running in the shell.
  const [showStats, setShowStats] = useState(false);
  const idleRef = useRef(0);

  useEffect(() => {
    if (frame) return; // inline: derived from the prop in render, zero lag
    const f = () => {
      setMiniState(isMini());
      setFsState(atFullscreen());
    };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [frame]);

  // Meta + loading from the bridge (getLoading is a SYNC boolean).
  // Subscribe FIRST, and never let the async seed overwrite a pushed
  // value: this mount effect runs before the bridge host's meta effect,
  // so the seed promise can resolve a PRE-push snapshot after the real
  // push already landed (the first-playback-of-session live-chrome bug).
  useEffect(() => {
    const a = api();
    if (!a) return;
    let pushed = false;
    const offMeta = a.onMeta((m) => {
      pushed = true;
      setMeta(m);
    });
    a.getMeta()
      .then((m) => {
        if (!pushed) setMeta(m);
      })
      .catch(() => {});
    setLoading(a.getLoading());
    const offLoading = a.onLoading(setLoading);
    return () => {
      offMeta();
      offLoading();
    };
  }, []);

  useEffect(() => {
    const off = api()?.onTracks?.(setTracks);
    return () => off?.();
  }, []);

  // Which text the VOD meta block shows (Settings → Player Overlay).
  const [overlayFields, setOverlayFields] = useState<OverlayMetaField[]>(
    loadOverlayMeta,
  );
  useEffect(() => onOverlayMetaChange(setOverlayFields), []);

  // Playback clock — only VOD pushes one (live streams have no duration).
  const [time, setTime] = useState<TimeInfo | null>(
    () => api()?.getTime?.() ?? null,
  );
  useEffect(() => {
    const off = api()?.onTime?.(setTime);
    return () => off?.();
  }, []);
  // Skip chip behavior (Settings → Skip Behavior) — flips live.
  const [skipBehavior, setSkipBehavior] = useState<SkipBehavior>(
    loadSkipBehavior,
  );
  useEffect(() => onSkipBehaviorChange(setSkipBehavior), []);

  // File chapter markers — the Skip Intro data source (Phase 1: named
  // chapters; aniskip comes later).
  const [chapters, setChapters] = useState<ChapterInfo[]>(
    () => api()?.getChapters?.() ?? [],
  );
  useEffect(() => {
    const off = api()?.onChapters?.(setChapters);
    return () => off?.();
  }, []);

  // Playback speed (VOD menu). A fresh mpv instance per stream means the
  // real rate resets to 1 on every switch — mirror that locally below.
  const [speed, setSpeed] = useState(1);
  const pickSpeed = useCallback((sp: number) => {
    setSpeed(sp);
    api()?.setSpeed?.(sp);
    if (vodRef.current) rememberPlayback({ speed: sp });
    setMenu(null);
  }, []);
  // Scrub-in-progress fraction (0..1); null = not scrubbing. While held,
  // the bar follows the pointer and the poll's updates don't fight it.
  const [scrub, setScrub] = useState<number | null>(null);
  const seekTrackRef = useRef<HTMLDivElement | null>(null);
  const scrubFrac = useCallback((clientX: number) => {
    const r = seekTrackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  }, []);

  /* Tune watchdog. `loading` flips false exactly once, on mpv's FIRST FRAME
   * (useDirectOverlay's mpv_status poll) — so a dead channel is `loading`
   * stuck true forever, which used to render as an eternal "loading" pulse.
   * Instead: after STALL_MS with no frame, silently reload the stream in
   * place (goLive = re-loadfile of the same URL, the proven live-edge
   * mechanic) up to TUNE_RETRIES times; if a retry lands a frame the
   * still-armed poll clears `loading` and the chain disarms. Out of retries
   * → an honest "isn't responding" card with a manual Retry. A channel
   * switch tears this whole overlay down, so state resets naturally;
   * user-initiated goLive while playing never arms it (`loading` is already
   * false). Mid-play death re-arms it too: the poll flips `loading` back on
   * when mpv reports EOF/idle (`ended`). */
  const TUNE_RETRIES = 2;
  const STALL_MS = 10_000;
  /** VOD gets its own profile: NO auto-reload, longer window. Re-loadfile
   * restarts a debrid download from byte zero (self-defeating for a big
   * remux that's merely slow to open), and every attempt is another
   * request against the user's debrid account — the 10s live cadence
   * burst-requested one file enough to get a real account rate-limited.
   * Slow VOD opens just wait; a genuinely dead source gets the honest
   * card (Retry / Try next available source) after the window. */
  const VOD_STALL_MS = 40_000;
  const [tune, setTune] = useState<"waiting" | "retrying" | "dead">("waiting");
  const [tuneAttempt, setTuneAttempt] = useState(0); // manual Retry re-arms
  const retriesRef = useRef(0);
  // The host's declaration wins (meta can be late — a VOD misread as live
  // here would goLive()-reload it on the 10s window, burning debrid
  // requests); the meta flip false→true still re-arms for the no-host
  // legacy entry.
  const vodSrc = vodProp ?? meta?.live === false;
  useEffect(() => {
    if (!loading) {
      retriesRef.current = 0;
      setTune("waiting");
      return;
    }
    let id = 0;
    const arm = () => {
      id = window.setTimeout(() => {
        if (!vodSrc && retriesRef.current < TUNE_RETRIES) {
          retriesRef.current += 1;
          setTune("retrying");
          api()?.goLive?.();
          arm();
        } else {
          setTune("dead");
        }
      }, vodSrc ? VOD_STALL_MS : STALL_MS);
    };
    arm();
    return () => window.clearTimeout(id);
  }, [loading, tuneAttempt, vodSrc]);
  // VOD auto-failover (Settings → AIOStreams, off by default): the moment
  // the watchdog declares the source dead, jump to the next candidate.
  const vodDeadRef = useRef(false);
  useEffect(() => {
    const isVod = vodProp ?? metaRefForDead.current?.live === false;
    if (tune !== "dead" || !isVod) {
      vodDeadRef.current = false;
      return;
    }
    if (vodDeadRef.current) return;
    vodDeadRef.current = true;
    if (loadSourceFailover()) api()?.nextSource?.();
  }, [tune, vodProp]);

  const retryTune = useCallback(() => {
    retriesRef.current = 0;
    setTune("retrying");
    api()?.goLive?.();
    setTuneAttempt((n) => n + 1); // re-arms the watchdog chain
  }, []);

  // Re-seed the favorite state whenever meta changes (open / channel switch).
  useEffect(() => {
    setFav(!!meta?.favorite);
  }, [meta]);

  const toggleFav = useCallback(() => {
    setFav((f) => !f);
    api()?.toggleFavorite?.();
  }, []);

  // Push volume + mute to mpv. Mute drives mpv's real mute property (not a
  // volume-0 fake), so the underlying level is untouched across mute/unmute.
  useEffect(() => {
    api()?.setVolume(Math.round(volume * 100));
    api()?.setMute(muted);
  }, [volume, muted]);

  // Channel switch (inline): the fresh mpv instance starts unpaused at the
  // live edge with default volume — resync the icon/indicator, and re-push
  // the user's volume/mute (read off refs; this must not re-run on slider
  // moves — the effect above owns those).
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    if (!playbackKey) return;
    setSpeed(1); // fresh mpv instance = rate 1
    setPaused(false);
    setLivePct(100);
    api()?.setVolume(Math.round(volumeRef.current * 100));
    api()?.setMute(mutedRef.current);
  }, [playbackKey]);
  // …and AGAIN when the new instance actually presents: the key-change
  // push above races the fresh mpv process (VOD URLs resolve async — the
  // command can land on the dying instance while the new one spawns at
  // default 100%). The bar position survived but the audible volume
  // didn't. loading→false is the one signal the instance is really up;
  // re-pushing after a mid-play rebuffer is idempotent. Track selection
  // and speed don't need this — they apply on the new instance's track
  // list landing (see the prefs effect below), which is already
  // post-spawn by construction.
  useEffect(() => {
    if (loading) return;
    api()?.setVolume(Math.round(volumeRef.current * 100));
    api()?.setMute(mutedRef.current);
  }, [loading]);

  // An open track menu holds the chrome awake (read off a ref so wake stays
  // stable); closing it restarts the idle timer the menu was holding.
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => {
      if (!menuRef.current) setActive(false);
    }, 2400);
  }, []);
  useEffect(() => {
    if (menu === null) wake();
  }, [menu, wake]);

  // Wheel over the video = volume, matching mpv's own convention. INLINE
  // ONLY: on the legacy overlay-webview path the wheel reaches the mpv child
  // first and mpv's native wheel-volume handles it — a handler there would
  // double-step. Inverted, the webview is on top and mpv never sees the
  // wheel, which is why this regressed. Native listener (passive:false) —
  // React's root wheel listeners are passive, so preventDefault would be
  // ignored via onWheel.
  const wheelHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!frame) return;
    const el = wheelHostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const up = e.deltaY < 0;
      if (up) setMuted(false);
      setVolume((v) =>
        Math.min(1, Math.max(0, +(v + (up ? 0.05 : -0.05)).toFixed(2))),
      );
      wake();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // mini flips which root exists, so re-attach when it changes.
  }, [frame, mini, wake]);

  // If the chrome does hide (e.g. the cursor left the player), take any open
  // menu down with it rather than leaving it open invisibly.
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);

  // Track selection: fire the api, flip the checkmark optimistically, and
  // let the 500ms mpv_status poll confirm (it re-pushes when mpv's `selected`
  // flags change, which also corrects us if mpv rejected the switch).
  const vodRef = useRef(false); // mirrors `vod` for the stable callbacks
  const tracksRef = useRef<Tracks | null>(null);
  tracksRef.current = tracks;
  const chooseAudio = useCallback((id: number) => {
    api()?.selectAudio?.(id);
    // VOD continuity: an explicit pick is remembered by LANGUAGE and
    // re-applied on the next episode's fresh mpv instance.
    if (vodRef.current) {
      const t = tracksRef.current?.audio.find((a) => a.id === id);
      if (t?.lang || t?.label)
        rememberPlayback({ audioLang: t.lang || t.label });
    }
    setTracks(
      (prev) =>
        prev && {
          ...prev,
          audio: prev.audio.map((t) => ({ ...t, selected: t.id === id })),
        },
    );
    setMenu(null);
  }, []);
  const chooseSub = useCallback((id: number | null) => {
    api()?.selectSub?.(id === null ? "no" : id);
    if (vodRef.current) {
      if (id === null) rememberPlayback({ subLang: "off" });
      else {
        const t = tracksRef.current?.subs.find((x) => x.id === id);
        if (t?.lang || t?.label)
          rememberPlayback({ subLang: t.lang || t.label });
      }
    }
    setTracks(
      (prev) =>
        prev && {
          ...prev,
          subs: prev.subs.map((t) => ({ ...t, selected: t.id === id })),
        },
    );
    setMenu(null);
  }, []);

  // Show on activity; toggle click-through so only [data-interactive] regions
  // take clicks (the rest passes to mpv, keeping it foreground). Hide the
  // instant the cursor leaves the player.
  useEffect(() => {
    if (mini) return; // mini owns its own hover behavior (CSS)
    wake();
    let ignoring = true;
    const setIgnore = (ig: boolean) => {
      if (ig === ignoring) return;
      ignoring = ig;
      api()?.setMouseIgnore(ig);
    };
    const onMove = (e: MouseEvent) => {
      wake();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setIgnore(!(el && el.closest("[data-interactive]")));
    };
    const onLeave = () => {
      window.clearTimeout(idleRef.current);
      setActive(false);
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) onLeave();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseout", onOut);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.clearTimeout(idleRef.current);
    };
  }, [mini, wake]);

  // Read the live value off a ref so the bridge side effect stays OUT of the
  // setState updater (updaters must be pure — StrictMode double-invokes them).
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const togglePlay = useCallback(() => {
    const next = !pausedRef.current;
    setPaused(next);
    api()?.setPause(next);
  }, []);

  // Seek mpv + walk the live-edge indicator (≈0.8%/sec, so ±10s ≈ ±8%).
  // For VOD, also bump the clock optimistically — the poll trues it up
  // within 500ms, but the bar shouldn't lag the keypress.
  const doSeek = useCallback((delta: number) => {
    api()?.seek(delta);
    setLivePct((p) => Math.min(100, Math.max(0, p + delta * 0.8)));
    setTime((t) =>
      t ? { ...t, pos: Math.min(t.dur, Math.max(0, t.pos + delta)) } : t,
    );
  }, []);

  // Jump to the live edge. A forward seek can't reach it (mpv never pulled the
  // data between the playback buffer and now), so this reloads the stream on
  // the same mpv instance — it restarts at the newest segment while the overlay
  // stays put (video just rebuffers). Then peg the indicator to live.
  const goLive = useCallback(() => {
    api()?.goLive?.();
    setLivePct(100);
  }, []);
  // At the live edge (within a hair of 100) → the dot burns bright; behind it
  // dims. The only way to fall behind in this UI is the seek controls, so the
  // indicator is an honest read of "are we live" without polling mpv.
  const atLive = livePct >= 99;

  // VOD: the seek row is a real scrubber and the LIVE affordances
  // disappear. The host's declaration wins; meta only decides for the
  // legacy no-host entry.
  const vod = vodProp ?? meta?.live === false;
  vodRef.current = vod;

  // VOD continuity, apply side: once per FILE, when its track list first
  // lands, re-select the remembered languages and speed (every stream is
  // a fresh mpv instance — without this, subs/speed die at each episode
  // boundary). Runs once per playbackKey, before any user pick for the
  // file; explicit picks afterward both win and update the memory.
  const appliedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vod || !tracks) return;
    const key = playbackKey ?? "mount";
    if (appliedKeyRef.current === key) return;
    appliedKeyRef.current = key;
    const prefs = loadPlaybackPrefs();
    if (prefs.audioLang) {
      const t = matchTrack(tracks.audio, prefs.audioLang);
      if (t && !t.selected) {
        api()?.selectAudio?.(t.id);
        setTracks(
          (prev) =>
            prev && {
              ...prev,
              audio: prev.audio.map((a) => ({ ...a, selected: a.id === t.id })),
            },
        );
      }
    }
    if (prefs.subLang === "off") {
      if (tracks.subs.some((x) => x.selected)) {
        api()?.selectSub?.("no");
        setTracks(
          (prev) =>
            prev && {
              ...prev,
              subs: prev.subs.map((x) => ({ ...x, selected: false })),
            },
        );
      }
    } else if (prefs.subLang) {
      const t = matchTrack(tracks.subs, prefs.subLang);
      if (t && !t.selected) {
        api()?.selectSub?.(t.id);
        setTracks(
          (prev) =>
            prev && {
              ...prev,
              subs: prev.subs.map((x) => ({ ...x, selected: x.id === t.id })),
            },
        );
      }
    }
    if (prefs.speed && prefs.speed !== 1) {
      setSpeed(prefs.speed);
      api()?.setSpeed?.(prefs.speed);
    }
  }, [vod, tracks, playbackKey]);
  const vodPct =
    scrub !== null
      ? scrub * 100
      : time && time.dur > 0
        ? Math.min(100, (time.pos / time.dur) * 100)
        : 0;

  // Inside a skip-worthy window right now? Exact AniSkip intervals (pushed
  // via meta.skips) take precedence — they're community-timed, not guessed
  // from chapter titles. Chapter heuristics remain the fallback. (Bounded:
  // a window covering half the file is mislabeled content, not an intro.)
  // "combine" merges a run of consecutive credits/preview chapters into
  // one jump.
  let skip: { label: string; to: number } | null = null;
  if (skipBehavior !== "hidden" && vod && time && time.dur > 0) {
    const r = meta?.skips?.find(
      (s) =>
        time.pos >= s.start &&
        time.pos < s.end &&
        s.end - s.start < time.dur * 0.5,
    );
    if (r) skip = { label: remoteSkipLabel(r.type), to: Math.min(r.end, time.dur) };
  }
  if (
    !skip &&
    skipBehavior !== "hidden" &&
    vod &&
    time &&
    time.dur > 0 &&
    chapters.length > 1
  ) {
    const idx = chapters.findIndex(
      (c, i) =>
        time.pos >= c.start &&
        (i + 1 >= chapters.length || time.pos < chapters[i + 1].start),
    );
    if (idx >= 0 && SKIP_RX.test(chapters[idx].title)) {
      const tailish = (t: string) => CREDITS_RX.test(t) || PREVIEW_RX.test(t);
      let last = idx;
      if (skipBehavior === "combine" && tailish(chapters[idx].title)) {
        while (
          last + 1 < chapters.length &&
          tailish(chapters[last + 1].title)
        )
          last++;
      }
      const end =
        last + 1 < chapters.length ? chapters[last + 1].start : time.dur;
      if (end - chapters[idx].start < time.dur * 0.5) {
        const span = chapters.slice(idx, last + 1).map((c) => c.title);
        const label =
          last > idx &&
          span.some((t) => CREDITS_RX.test(t)) &&
          span.some((t) => PREVIEW_RX.test(t))
            ? "Skip Credits & Preview"
            : skipLabel(chapters[idx].title);
        skip = { label, to: end };
      }
    }
  }

  // Credits-window signal for the host (StreamScreen's mini Up Next):
  // true while the clock sits inside an ENDING window — an AniSkip
  // ed/mixed-ed interval, or a credits-titled chapter starting in the
  // last 40% of the file (an OP labeled "OP/ED" early on must not pop
  // the card). Independent of skipBehavior: hiding the skip CHIP is a
  // chrome preference, not "never tell me the credits started".
  let creditsNow = false;
  if (vod && time && time.dur > 0) {
    creditsNow = !!meta?.skips?.some(
      (s) =>
        s.type.endsWith("ed") &&
        time.pos >= s.start &&
        time.pos < s.end &&
        s.end - s.start < time.dur * 0.5,
    );
    if (!creditsNow && chapters.length > 1) {
      const idx = chapters.findIndex(
        (c, i) =>
          time.pos >= c.start &&
          (i + 1 >= chapters.length || time.pos < chapters[i + 1].start),
      );
      creditsNow =
        idx >= 0 &&
        CREDITS_RX.test(chapters[idx].title) &&
        chapters[idx].start >= time.dur * 0.6;
    }
  }
  useEffect(() => {
    api()?.creditsWindow?.(creditsNow);
  }, [creditsNow]);

  const toggleFullscreen = useCallback(() => {
    if (fsNow()) api()?.exitFullscreen?.();
    else api()?.fullscreen?.();
  }, [fsNow]);

  // YouTube-style shortcuts. Fires whether the key was captured by the main
  // webview (forwarded via onKey) or hit the overlay directly. Returns
  // whether the key was handled (the inline document listener uses it to
  // preventDefault without eating unrelated keys).
  const handleKey = useCallback(
    (key: string): boolean => {
      switch (key.toLowerCase()) {
        case " ":
        case "k":
          togglePlay();
          break;
        case "m":
          setMuted((x) => !x);
          break;
        case "arrowup":
          setMuted(false);
          setVolume((v) => Math.min(1, +(v + 0.05).toFixed(2)));
          break;
        case "arrowdown":
          setVolume((v) => Math.max(0, +(v - 0.05).toFixed(2)));
          break;
        case "arrowleft":
          doSeek(-5);
          break;
        case "arrowright":
          doSeek(5);
          break;
        case "j":
          doSeek(-10);
          break;
        case "l":
          doSeek(10);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "t":
          // t = theater: expand from mini, collapse from theater — and from
          // fullscreen, drop back to THEATER (not to wherever fullscreen was
          // entered from: theater persists across fullscreen, so a mini→f
          // ride would otherwise land in mini). Expand first so leaving
          // fullscreen can't flash the mini box.
          if (miniNow()) api()?.expand?.();
          else if (fsNow()) {
            api()?.expand?.();
            api()?.exitFullscreen?.();
          } else api()?.collapse?.();
          break;
        case "i":
          // Stats overlay — theater/fullscreen only, and only in the shell
          // (mpv_stats is a Tauri command). Ignored otherwise (unhandled).
          if (!isTauri() || miniNow()) return false;
          setShowStats((v) => !v);
          break;
        case "escape":
          // VOD: Escape TOGGLES theater↔fullscreen and can never leave
          // the player — the ✕ is the only exit. Live keeps the ladder
          // (menu → exit fullscreen → collapse to mini).
          if (menuRef.current) setMenu(null);
          else if (vod) toggleFullscreen();
          else if (fsNow()) api()?.exitFullscreen?.();
          else api()?.collapse?.();
          break;
        default:
          return false;
      }
      wake();
      return true;
    },
    [doSeek, fsNow, miniNow, toggleFullscreen, togglePlay, vod, wake],
  );

  useEffect(() => {
    const off = api()?.onKey?.(handleKey);
    const onDocKey = (e: KeyboardEvent) => {
      // A focused control already acts on its own keys — don't ALSO fire the
      // global shortcut, or Space double-toggles play (net no-op) and an arrow
      // on the volume slider both nudges it and seeks. Buttons own Space/Enter;
      // inputs (the range slider) own the arrows — and inline (inverted
      // player) the app's buttons own their arrows too (roving tablists,
      // guide cells), so arrows on any button stay theirs.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (
        tag === "BUTTON" &&
        (e.key === " " || e.key === "Enter" || e.key.startsWith("Arrow"))
      )
        return;
      if (handleKey(e.key)) e.preventDefault();
    };
    document.addEventListener("keydown", onDocKey);
    return () => {
      off?.();
      document.removeEventListener("keydown", onDocKey);
    };
  }, [handleKey]);

  const volPct = Math.round((muted ? 0 : volume) * 100);

  // MINI: click anywhere expands to theater; play/pause + ✕ stop propagation.
  if (mini) {
    return (
      <div
        ref={wheelHostRef}
        className="mini-overlay"
        data-interactive
        onClick={() => api()?.expand?.()}
      >
        {loading && (
          <TuneCard meta={meta} phase={tune} onRetry={retryTune} vod={vod} compact />
        )}
        <button
          type="button"
          className="overlay__btn overlay__play"
          aria-label={paused ? "Play" : "Pause"}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
        >
          {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
        </button>
        <button
          type="button"
          className="overlay__btn mini-overlay__close"
          aria-label="Stop"
          onClick={(e) => {
            e.stopPropagation();
            api()?.close();
          }}
        >
          <CloseIcon size={18} />
        </button>
      </div>
    );
  }

  // THEATER / FULLSCREEN.
  return (
    <div
      ref={wheelHostRef}
      className={
        "theater-overlay" +
        (active ? " player--active" : "") +
        (fs ? " theater-overlay--fs" : "")
      }
      onClick={(e) => {
        // Click the picture (not a control): close an open menu, else play/pause.
        if (!(e.target as Element).closest("[data-interactive]")) {
          if (menuRef.current) setMenu(null);
          else togglePlay();
          wake();
        }
      }}
    >
      {loading && <TuneCard meta={meta} phase={tune} onRetry={retryTune} vod={vod} />}

      {showStats && isTauri() && <StatsOverlay />}

      <div className="theater-topscrim" aria-hidden />

      {/* VOD: no favorites — the star is live-only chrome. (The
        * fullscreen toggle applies to both: VOD theater ↔ OS fullscreen.) */}
      {!vod && (
        <div className="theater-topleft" data-interactive>
          <button
            type="button"
            className={"player__btn player__btn--glass" + (fav ? " is-fav" : "")}
            aria-label={fav ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={fav}
            onClick={toggleFav}
          >
            {fav ? <RainbowStarIcon size={20} /> : <StarIcon size={20} />}
          </button>
        </div>
      )}

      <div className="theater-topright" data-interactive>
        <button
          type="button"
          className="player__btn player__btn--glass"
          aria-label="Pop out"
          onClick={() => api()?.popout?.()}
        >
          <PopoutIcon size={20} />
        </button>
        <button
          type="button"
          className="player__btn player__btn--glass"
          aria-label={fs ? "Exit fullscreen" : "Fullscreen"}
          onClick={toggleFullscreen}
        >
          {fs ? <ExitFullscreenIcon size={20} /> : <FullscreenIcon size={20} />}
        </button>
        <button
          type="button"
          className="player__btn player__btn--glass"
          aria-label={fs ? "Exit fullscreen" : "Close"}
          onClick={() => (fs ? api()?.exitFullscreen?.() : api()?.collapse?.())}
        >
          <CloseIcon size={20} />
        </button>
      </div>

      {skip && !mini && (
        <button
          type="button"
          className="skip-chip"
          data-interactive
          onClick={() => api()?.seekAbs?.(skip.to)}
        >
          {skip.label}
        </button>
      )}

      <div className="theater-bar">
        {meta && (
          <div className="theater-bar__meta">
            {meta.logo && (!vod || overlayFields.includes("logo")) && (
              <img
                className="theater-bar__logo"
                src={meta.logo}
                alt=""
                aria-hidden
              />
            )}
            <div className="theater-bar__text">
              {/* VOD: no channel line (the art IS the title); the heading
                * composes from the granular Player Overlay toggles. */}
              {!vod && (
                <p className="theater-bar__chan">
                  <span className="theater-bar__name">{meta.channelName}</span>
                  {meta.sourceName && (
                    <span className="theater-bar__source">{meta.sourceName}</span>
                  )}
                </p>
              )}
              {vod
                ? (() => {
                    const heading = overlayHeading(
                      overlayFields,
                      meta.vod,
                      meta.title,
                    );
                    return heading ? (
                      <h2 className="theater-bar__title">{heading}</h2>
                    ) : null;
                  })()
                : meta.title && (
                    <h2 className="theater-bar__title">{meta.title}</h2>
                  )}
              {meta.description &&
                (!vod || overlayFields.includes("description")) && (
                  <p className="theater-bar__desc">{meta.description}</p>
                )}
            </div>
          </div>
        )}

        <div className="theater-seek" data-interactive>
          {vod ? (
            <>
              <div
                className="theater-seek__track theater-seek__track--vod"
                ref={seekTrackRef}
                onPointerDown={(e) => {
                  if (e.button !== 0) return; // left button scrubs, only
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setScrub(scrubFrac(e.clientX));
                }}
                onPointerMove={(e) => {
                  if (scrub !== null) setScrub(scrubFrac(e.clientX));
                }}
                onPointerUp={(e) => {
                  if (scrub === null) return;
                  const f = scrubFrac(e.clientX);
                  setScrub(null);
                  if (time && time.dur > 0) {
                    api()?.seekAbs?.(f * time.dur);
                    // Optimistic: the poll trues it up within 500ms.
                    setTime({ pos: f * time.dur, dur: time.dur });
                  }
                }}
                onPointerCancel={() => setScrub(null)}
              >
                <div
                  className="theater-seek__fill"
                  style={{ width: `${vodPct}%` }}
                />
                <span
                  className="theater-seek__knob"
                  style={{ left: `${vodPct}%` }}
                />
              </div>
              <div className="theater-seek__labels">
                <span>
                  {time
                    ? fmtClock(scrub !== null ? scrub * time.dur : time.pos)
                    : "0:00"}
                </span>
                <span>{time ? fmtClock(time.dur) : "–:––"}</span>
              </div>
            </>
          ) : (
            <>
              <div className="theater-seek__track">
                <div
                  className="theater-seek__fill"
                  style={{ width: `${livePct}%` }}
                />
                <span
                  className="theater-seek__knob"
                  style={{ left: `${livePct}%` }}
                />
              </div>
              <div className="theater-seek__labels">
                <span>{meta?.startLabel ?? ""}</span>
                <span className="theater-seek__live">LIVE</span>
              </div>
            </>
          )}
        </div>

        <div className="theater-controls" data-interactive>
          <div className="theater-controls__group">
            <button
              type="button"
              className="player__btn"
              aria-label="Back 10 seconds"
              onClick={() => doSeek(-10)}
            >
              <SkipBackIcon size={24} />
            </button>
            <button
              type="button"
              className="player__btn player__btn--play"
              aria-label={paused ? "Play" : "Pause"}
              onClick={togglePlay}
            >
              {paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
            </button>
            <button
              type="button"
              className="player__btn"
              aria-label="Forward 10 seconds"
              onClick={() => doSeek(10)}
            >
              <SkipFwdIcon size={24} />
            </button>
            {vod && meta?.vod?.hasNext && (
              <button
                type="button"
                className="player__btn"
                aria-label="Next episode"
                onClick={() => api()?.nextEpisode?.()}
              >
                <NextEpisodeIcon size={22} />
              </button>
            )}
            {!vod && (
              <button
                type="button"
                className={"theater-live" + (atLive ? " is-live" : "")}
                aria-label="Jump to live"
                onClick={goLive}
              >
                <span className="theater-live__dot" />
                LIVE
              </button>
            )}
          </div>

          <div className="theater-controls__group">
            {/* In-playback source switcher — VOD only. */}
            {vod && (
              <button
                type="button"
                className="player__btn"
                aria-label="Sources"
                onClick={() => api()?.sourcePanel?.()}
              >
                <PanelIcon size={20} />
              </button>
            )}
            {/* Playback speed — VOD only (live has no rate to bend). */}
            {vod && (
              <div className="theater-tracks">
                <button
                  type="button"
                  className={
                    "player__btn player__btn--speed" +
                    (menu === "speed" ? " is-open" : "")
                  }
                  aria-label="Playback speed"
                  aria-haspopup="menu"
                  aria-expanded={menu === "speed"}
                  onClick={() =>
                    setMenu((m) => (m === "speed" ? null : "speed"))
                  }
                >
                  {speed === 1 ? "1×" : `${speed}×`}
                </button>
                {menu === "speed" && (
                  <div className="track-menu" role="menu" aria-label="Speed">
                    <p className="track-menu__head">Speed</p>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        role="menuitemradio"
                        aria-checked={speed === sp}
                        className={
                          "track-menu__item" +
                          (speed === sp ? " is-selected" : "")
                        }
                        onClick={() => pickSpeed(sp)}
                      >
                        {sp}×
                        {speed === sp && <CheckIcon size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Stats for nerds (theater/fullscreen only; needs the shell for
              * the mpv_stats command). Toggles the top-left telemetry panel. */}
            {isTauri() && (
              <button
                type="button"
                className={"player__btn" + (showStats ? " is-open" : "")}
                aria-label="Stats for nerds"
                aria-pressed={showStats}
                onClick={() => setShowStats((v) => !v)}
              >
                <StatsIcon size={20} />
              </button>
            )}
            {/* Always visible, grayed out when there's nothing to choose:
              * audio needs ≥2 tracks (one track = no choice), subs need ≥1
              * (off/on is a real choice even with one track). A disabled
              * button can't open its menu. */}
            <div className="theater-tracks">
              <button
                type="button"
                className={"player__btn" + (menu === "audio" ? " is-open" : "")}
                aria-label="Audio track"
                aria-haspopup="menu"
                aria-expanded={menu === "audio"}
                disabled={(tracks?.audio.length ?? 0) < 2}
                onClick={() => setMenu((m) => (m === "audio" ? null : "audio"))}
              >
                <LanguageIcon size={20} />
              </button>
              {menu === "audio" && tracks && tracks.audio.length >= 2 && (
                <div className="track-menu" role="menu" aria-label="Audio tracks">
                  <p className="track-menu__head">Audio</p>
                  {tracks.audio.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={t.selected}
                      className={
                        "track-menu__item" + (t.selected ? " is-selected" : "")
                      }
                      onClick={() => chooseAudio(t.id)}
                    >
                      <span className="track-menu__label">{t.label}</span>
                      {t.selected && <CheckIcon size={15} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="theater-tracks">
              <button
                type="button"
                className={"player__btn" + (menu === "subs" ? " is-open" : "")}
                aria-label="Subtitles"
                aria-haspopup="menu"
                aria-expanded={menu === "subs"}
                disabled={(tracks?.subs.length ?? 0) < 1}
                onClick={() => setMenu((m) => (m === "subs" ? null : "subs"))}
              >
                <CcIcon size={20} />
              </button>
              {menu === "subs" && tracks && tracks.subs.length >= 1 && (
                <div className="track-menu" role="menu" aria-label="Subtitles">
                  <p className="track-menu__head">Subtitles</p>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={!tracks.subs.some((t) => t.selected)}
                    className={
                      "track-menu__item" +
                      (tracks.subs.some((t) => t.selected) ? "" : " is-selected")
                    }
                    onClick={() => chooseSub(null)}
                  >
                    <span className="track-menu__label">Off</span>
                    {!tracks.subs.some((t) => t.selected) && (
                      <CheckIcon size={15} />
                    )}
                  </button>
                  {tracks.subs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={t.selected}
                      className={
                        "track-menu__item" + (t.selected ? " is-selected" : "")
                      }
                      onClick={() => chooseSub(t.id)}
                    >
                      <span className="track-menu__label">{t.label}</span>
                      {t.selected && <CheckIcon size={15} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="theater-vol">
              <button
                type="button"
                className="player__btn"
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={() => setMuted((m) => !m)}
              >
                {muted || volPct === 0 ? (
                  <MuteIcon size={20} />
                ) : (
                  <VolumeIcon size={20} />
                )}
              </button>
              <input
                className="player__volume theater-vol__slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setMuted(false);
                  setVolume(parseFloat(e.target.value));
                }}
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The tune-in surface: a branded ident (logo + channel + programme) instead
 * of a bare pulse over black, with the watchdog's escalation — quiet loading,
 * "reconnecting" while it self-heals, and an honest isn't-responding card
 * (with Retry) when the channel is dead. Compact variant for the mini box. */
function TuneCard({
  meta,
  phase,
  onRetry,
  compact = false,
  vod = false,
}: {
  meta: TheaterMeta | null;
  phase: "waiting" | "retrying" | "dead";
  onRetry: () => void;
  compact?: boolean;
  /** VOD variant: solid black, just the title art breathing — no text,
   * no status. The dead card still shows (over black) so a broken
   * source stays diagnosable. */
  vod?: boolean;
}) {
  if (vod && phase !== "dead") {
    return (
      <div className="tune tune--vod" aria-live="polite">
        {meta?.logo ? (
          <img className="tune__vodlogo" src={meta.logo} alt="" aria-hidden />
        ) : (
          <span className="tune__vodtitle">{meta?.channelName ?? ""}</span>
        )}
      </div>
    );
  }
  return (
    <div
      className={
        "tune" +
        (compact ? " tune--compact" : "") +
        (vod ? " tune--vod" : "")
      }
      aria-live="polite"
    >
      <div className="tune__ident">
        {meta?.logo && (
          <img className="tune__logo" src={meta.logo} alt="" aria-hidden />
        )}
        {meta?.channelName && (
          <span className="tune__channel">{meta.channelName}</span>
        )}
        {!compact && meta?.title && (
          <span className="tune__title">{meta.title}</span>
        )}
      </div>
      {phase === "dead" ? (
        <div className="tune__dead" data-interactive>
          <p className="tune__dead-msg">
            {vod
              ? "This source isn\u2019t responding \u2014 it\u2019s the stream, not you."
              : "This channel isn\u2019t responding \u2014 it\u2019s the stream, not you."}
          </p>
          <button type="button" className="tune__retry" onClick={onRetry}>
            Retry
          </button>
          {vod && api()?.nextSource && (
            <button
              type="button"
              className="tune__retry"
              onClick={() => api()?.nextSource?.()}
            >
              Try next available source
            </button>
          )}
        </div>
      ) : (
        <span className="tune__status">
          {phase === "retrying" ? "reconnecting" : "loading"}
        </span>
      )}
    </div>
  );
}
