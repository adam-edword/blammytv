import { useCallback, useEffect, useRef, useState } from "react";
import type { TheaterMeta } from "../../lib/tauri";
import {
  CloseIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipFwdIcon,
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
 * chrome). Ported from the old build, live-only (no VOD seek/tracks/speed).
 */
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
  setMouseIgnore: (ignore: boolean) => void;
  getMeta: () => Promise<TheaterMeta | null>;
  onMeta: (cb: (meta: TheaterMeta | null) => void) => () => void;
  getLoading: () => boolean;
  onLoading: (cb: (loading: boolean) => void) => () => void;
  onKey?: (cb: (key: string) => void) => () => void;
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

  // Push volume/mute to mpv.
  useEffect(() => {
    api()?.setVolume(Math.round((muted ? 0 : volume) * 100));
  }, [volume, muted]);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setActive(false), 2400);
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

  const togglePlay = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      api()?.setPause(next);
      return next;
    });
  }, []);

  // Seek mpv + walk the live-edge indicator (≈0.8%/sec, so ±10s ≈ ±8%).
  const doSeek = useCallback((delta: number) => {
    api()?.seek(delta);
    setLivePct((p) => Math.min(100, Math.max(0, p + delta * 0.8)));
  }, []);

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
          if (atFullscreen()) api()?.exitFullscreen?.();
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
    const onDocKey = (e: KeyboardEvent) => handleKey(e.key);
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
        {loading && <LoadingGlyph />}
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
        // Click the picture (not a control) to play/pause.
        if (!(e.target as Element).closest("[data-interactive]")) {
          togglePlay();
          wake();
        }
      }}
    >
      {loading && <LoadingGlyph />}

      <div className="theater-topright" data-interactive>
        <button
          type="button"
          className="player__btn"
          aria-label={fs ? "Exit fullscreen" : "Fullscreen"}
          onClick={toggleFullscreen}
        >
          {fs ? <ExitFullscreenIcon size={20} /> : <FullscreenIcon size={20} />}
        </button>
        <button
          type="button"
          className="player__btn"
          aria-label={fs ? "Exit fullscreen" : "Close"}
          onClick={() => (fs ? api()?.exitFullscreen?.() : api()?.collapse?.())}
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="theater-bar">
        {meta && (
          <div className="theater-bar__meta">
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
          </div>

          <div className="theater-controls__group">
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

/** Centered pulsing "loading" while a source buffers. */
function LoadingGlyph() {
  return (
    <div className="comp-loading" aria-live="polite">
      <span className="comp-loading__text">loading</span>
    </div>
  );
}
