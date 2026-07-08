import { useCallback, useEffect, useRef, useState } from "react";
import type { TheaterMeta } from "../../lib/tauri";
import {
  CcIcon,
  CheckIcon,
  CloseIcon,
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
  VolumeIcon,
} from "../../ui/icons";

/**
 * The on-video chrome, rendered in the transparent overlay webview Rust
 * composites over the mpv child (main.tsx routes `?overlay=1` here). Controls
 * drive mpv through the Rust-injected `window.overlayApi` bridge, NOT Tauri.
 *
 * Three states, keyed off the overlay window's own size (it tracks the player
 * box): MINI (small — play/pause + ✕ + click-to-expand), THEATER (large
 * windowed — full auto-hiding chrome), FULLSCREEN (fills the monitor — same
 * chrome). Ported from the old build, live-only (no VOD seek/speed).
 */

/** One entry from mpv's track list, as pushed by comp.rs (`{type:'tracks'}`,
 * polled every 500ms Rust-side and re-pushed whenever it changes). */
interface TrackEntry {
  id: number;
  label: string;
  lang: string;
  selected: boolean;
}

interface Tracks {
  audio: TrackEntry[];
  subs: TrackEntry[];
}

interface OverlayApi {
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

const api = () => window.overlayApi;

/** True when the overlay fills (nearly) the whole monitor — i.e. fullscreen. */
const atFullscreen = () => window.innerWidth >= window.screen.width * 0.95;
/** The mini box is uniquely short (≈278px, 494×16:9); theater fills the main
 * content area and fullscreen the monitor, both far taller. Keying mini off
 * height (not width) survives a narrow window where the theater fill is also
 * narrow. */
const isMini = () => window.innerHeight < 450;

export function TheaterOverlay() {
  const [meta, setMeta] = useState<TheaterMeta | null>(null);
  const [loading, setLoading] = useState(() => api()?.getLoading() ?? true);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Live-edge position (%). Full = at the live edge; seeking back walks it
  // left, forward walks it toward live. mpv exposes no live position for a
  // live stream, so this is a client-side indicator that tracks the seeks.
  const [livePct, setLivePct] = useState(100);
  const [active, setActive] = useState(true); // chrome shown (auto-hides)
  const [mini, setMini] = useState(isMini);
  const [fs, setFs] = useState(atFullscreen);
  // Favorite is seeded from meta at open/channel-change, then owned locally so a
  // click flips instantly (the main app persists the real list via the bridge).
  const [fav, setFav] = useState(false);
  // Audio/sub tracks, seeded sync from the bridge cache then pushed on change.
  const [tracks, setTracks] = useState<Tracks | null>(
    () => api()?.getTracks?.() ?? null,
  );
  const [menu, setMenu] = useState<"audio" | "subs" | null>(null);
  const idleRef = useRef(0);

  useEffect(() => {
    const f = () => {
      setMini(isMini());
      setFs(atFullscreen());
    };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  // Meta + loading from the bridge (getLoading is a SYNC boolean).
  useEffect(() => {
    const a = api();
    if (!a) return;
    a.getMeta().then(setMeta).catch(() => {});
    const offMeta = a.onMeta(setMeta);
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

  /* Tune watchdog. `loading` flips false exactly once, on mpv's FIRST FRAME
   * (comp.rs spawn_loader_watch) — so a dead channel is `loading` stuck true
   * forever, which used to render as an eternal "loading" pulse. Instead:
   * after STALL_MS with no frame, silently reload the stream in place
   * (goLive = re-loadfile of the same URL, the proven live-edge mechanic) up
   * to TUNE_RETRIES times; if a retry lands a frame the still-armed loader
   * watch clears `loading` and the chain disarms. Out of retries → an honest
   * "isn't responding" card with a manual Retry. A channel switch tears this
   * whole overlay down, so state resets naturally; user-initiated goLive
   * while playing never arms it (`loading` is already false). Mid-play death
   * detection needs an mpv end-file signal from comp.rs — batched with the
   * Windows native pass. */
  const TUNE_RETRIES = 2;
  const STALL_MS = 10_000;
  const [tune, setTune] = useState<"waiting" | "retrying" | "dead">("waiting");
  const [tuneAttempt, setTuneAttempt] = useState(0); // manual Retry re-arms
  const retriesRef = useRef(0);
  useEffect(() => {
    if (!loading) {
      retriesRef.current = 0;
      setTune("waiting");
      return;
    }
    let id = 0;
    const arm = () => {
      id = window.setTimeout(() => {
        if (retriesRef.current < TUNE_RETRIES) {
          retriesRef.current += 1;
          setTune("retrying");
          api()?.goLive?.();
          arm();
        } else {
          setTune("dead");
        }
      }, STALL_MS);
    };
    arm();
    return () => window.clearTimeout(id);
  }, [loading, tuneAttempt]);
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
  // If the chrome does hide (e.g. the cursor left the player), take any open
  // menu down with it rather than leaving it open invisibly.
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);

  // Track selection: fire the bridge, flip the checkmark optimistically, and
  // let comp.rs's 500ms track poll confirm (it re-pushes when mpv's `selected`
  // flags change, which also corrects us if mpv rejected the switch).
  const chooseAudio = useCallback((id: number) => {
    api()?.selectAudio?.(id);
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
  const doSeek = useCallback((delta: number) => {
    api()?.seek(delta);
    setLivePct((p) => Math.min(100, Math.max(0, p + delta * 0.8)));
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

  const toggleFullscreen = useCallback(() => {
    if (atFullscreen()) api()?.exitFullscreen?.();
    else api()?.fullscreen?.();
  }, []);

  // YouTube-style shortcuts. Fires whether the key was captured by the main
  // webview (forwarded via onKey) or hit the overlay directly.
  const handleKey = useCallback(
    (key: string) => {
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
          if (isMini()) api()?.expand?.();
          else api()?.collapse?.();
          break;
        case "escape":
          if (menuRef.current) setMenu(null);
          else if (atFullscreen()) api()?.exitFullscreen?.();
          else api()?.collapse?.();
          break;
        default:
          return;
      }
      wake();
    },
    [doSeek, toggleFullscreen, togglePlay, wake],
  );

  useEffect(() => {
    const off = api()?.onKey?.(handleKey);
    const onDocKey = (e: KeyboardEvent) => {
      // A focused control already acts on its own keys — don't ALSO fire the
      // global shortcut, or Space double-toggles play (net no-op) and an arrow
      // on the volume slider both nudges it and seeks. Buttons own Space/Enter;
      // inputs (the range slider) own the arrows.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      handleKey(e.key);
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
        className="mini-overlay"
        data-interactive
        onClick={() => api()?.expand?.()}
      >
        {loading && (
          <TuneCard meta={meta} phase={tune} onRetry={retryTune} compact />
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
      {loading && <TuneCard meta={meta} phase={tune} onRetry={retryTune} />}

      <div className="theater-topscrim" aria-hidden />

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

      <div className="theater-bar">
        {meta && (
          <div className="theater-bar__meta">
            {meta.logo && (
              <img
                className="theater-bar__logo"
                src={meta.logo}
                alt=""
                aria-hidden
              />
            )}
            <div className="theater-bar__text">
              <p className="theater-bar__chan">
                <span className="theater-bar__name">{meta.channelName}</span>
                {meta.sourceName && (
                  <span className="theater-bar__source">{meta.sourceName}</span>
                )}
              </p>
              {meta.title && (
                <h2 className="theater-bar__title">{meta.title}</h2>
              )}
              {meta.description && (
                <p className="theater-bar__desc">{meta.description}</p>
              )}
            </div>
          </div>
        )}

        <div className="theater-seek" data-interactive>
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
            <button
              type="button"
              className={"theater-live" + (atLive ? " is-live" : "")}
              aria-label="Jump to live"
              onClick={goLive}
            >
              <span className="theater-live__dot" />
              LIVE
            </button>
          </div>

          <div className="theater-controls__group">
            {/* Audio menu only when there's a choice; CC whenever subs exist
              * (off/on is a real choice even with one track). */}
            {(tracks?.audio.length ?? 0) >= 2 && (
              <div className="theater-tracks">
                <button
                  type="button"
                  className={
                    "player__btn" + (menu === "audio" ? " is-open" : "")
                  }
                  aria-label="Audio track"
                  aria-haspopup="menu"
                  aria-expanded={menu === "audio"}
                  onClick={() => setMenu((m) => (m === "audio" ? null : "audio"))}
                >
                  <LanguageIcon size={20} />
                </button>
                {menu === "audio" && (
                  <div className="track-menu" role="menu" aria-label="Audio tracks">
                    <p className="track-menu__head">Audio</p>
                    {tracks!.audio.map((t) => (
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
            )}
            {(tracks?.subs.length ?? 0) >= 1 && (
              <div className="theater-tracks">
                <button
                  type="button"
                  className={"player__btn" + (menu === "subs" ? " is-open" : "")}
                  aria-label="Subtitles"
                  aria-haspopup="menu"
                  aria-expanded={menu === "subs"}
                  onClick={() => setMenu((m) => (m === "subs" ? null : "subs"))}
                >
                  <CcIcon size={20} />
                </button>
                {menu === "subs" && (
                  <div className="track-menu" role="menu" aria-label="Subtitles">
                    <p className="track-menu__head">Subtitles</p>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={!tracks!.subs.some((t) => t.selected)}
                      className={
                        "track-menu__item" +
                        (tracks!.subs.some((t) => t.selected)
                          ? ""
                          : " is-selected")
                      }
                      onClick={() => chooseSub(null)}
                    >
                      <span className="track-menu__label">Off</span>
                      {!tracks!.subs.some((t) => t.selected) && (
                        <CheckIcon size={15} />
                      )}
                    </button>
                    {tracks!.subs.map((t) => (
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
            )}
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
}: {
  meta: TheaterMeta | null;
  phase: "waiting" | "retrying" | "dead";
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={"tune" + (compact ? " tune--compact" : "")}
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
            This channel isn&rsquo;t responding — it&rsquo;s the stream, not
            you.
          </p>
          <button type="button" className="tune__retry" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <span className="tune__status">
          {phase === "retrying" ? "reconnecting" : "loading"}
        </span>
      )}
    </div>
  );
}
