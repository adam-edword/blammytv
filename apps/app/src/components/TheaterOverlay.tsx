import { useCallback, useEffect, useRef, useState } from "react";
import { slotText } from "slot-text";
import "slot-text/style.css";
import type { TheaterMeta } from "./Player";
import {
  PlayIcon,
  PauseIcon,
  VolumeIcon,
  MuteIcon,
  CloseIcon,
  SkipBackIcon,
  SkipFwdIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
  PopoutIcon,
} from "./icons";

/** True when the overlay fills (nearly) the whole monitor — i.e. fullscreen. */
const atFullscreen = () => window.innerWidth >= window.screen.width * 0.95;

/** Bridge exposed by overlay-preload.cjs (native theater window). */
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
  popout?: () => void; // pop into mpv's own floating window
  setMouseIgnore: (ignore: boolean) => void;
  getMeta: () => Promise<TheaterMeta | null>;
  onMeta: (cb: (meta: TheaterMeta | null) => void) => () => void;
  getLoading?: () => boolean;
  onLoading?: (cb: (loading: boolean) => void) => () => void;
  onKey?: (cb: (key: string) => void) => () => void;
}

/** Centered "loading" with the slot-text roll while a source buffers. */
function LoadingGlyph() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const label = slotText(el, "loading");
    label.set("loading", {
      stagger: 75,
      duration: 680,
      bounce: 1,
      skipUnchanged: false,
    });
    return () => label.destroy();
  }, []);
  return (
    <div className="comp-loading" aria-live="polite">
      <span ref={ref} className="comp-loading__text" />
    </div>
  );
}

const api = (window as unknown as { overlayApi?: OverlayApi }).overlayApi;

/**
 * The theater chrome rendered in the transparent overlay window that floats over
 * the native mpv surface. Same look as the in-page theater bar; controls drive
 * mpv through the overlay bridge. Auto-hides when idle, and toggles the window's
 * click-through so only the controls take clicks (mpv keeps the foreground).
 */
export function TheaterOverlay() {
  const [meta, setMeta] = useState<TheaterMeta | null>(null);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true);
  const idleRef = useRef<number>(0);
  // The overlay fills the layer rect; when small it's the in-app preview box
  // (render mini: just ✕ + click-to-expand), when large it's theater mode.
  const [mini, setMini] = useState(() => window.innerWidth < 1000);
  const [fs, setFs] = useState(atFullscreen);
  useEffect(() => {
    const f = () => {
      setMini(window.innerWidth < 1000);
      setFs(atFullscreen());
    };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  // Pull initial meta + subscribe to live updates.
  useEffect(() => {
    let alive = true;
    api?.getMeta().then((m) => alive && setMeta(m));
    const off = api?.onMeta((m) => setMeta(m));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // Loader: shown until mpv reports it's actually presenting (core-idle == no).
  const [loading, setLoading] = useState(() => api?.getLoading?.() ?? true);
  useEffect(() => {
    const off = api?.onLoading?.((l) => setLoading(l));
    return () => off?.();
  }, []);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setActive(false), 2400);
  }, []);

  // Show on activity; toggle click-through so only [data-interactive] regions
  // take clicks (the rest passes through to mpv, keeping it foreground).
  useEffect(() => {
    wake();
    let ignoring = true;
    const setIgnore = (ig: boolean) => {
      if (ig === ignoring) return;
      ignoring = ig;
      api?.setMouseIgnore(ig);
    };
    const onMove = (e: MouseEvent) => {
      wake();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setIgnore(!(el && el.closest("[data-interactive]")));
    };
    // YouTube-style: hide the chrome the instant the cursor leaves the player
    // (the forwarded WM_MOUSELEAVE fires a leave on the document root).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push volume/mute to mpv.
  useEffect(() => {
    api?.setVolume(Math.round((muted ? 0 : volume) * 100));
  }, [volume, muted]);

  const togglePlay = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      api?.setPause(next);
      return next;
    });
  }, []);

  // YouTube-style shortcuts. Volume/mute drive mpv via the volume effect; seek
  // and mode changes go straight through the bridge. Runs whether the key was
  // captured by the main webview (forwarded via onKey) or hit the overlay direct.
  const handleKey = useCallback(
    (key: string) => {
      const k = key.length === 1 ? key.toLowerCase() : key;
      switch (k) {
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
          api?.seek(-5);
          break;
        case "arrowright":
          api?.seek(5);
          break;
        case "j":
          api?.seek(-10);
          break;
        case "l":
          api?.seek(10);
          break;
        case "f":
          if (atFullscreen()) api?.exitFullscreen?.();
          else api?.fullscreen?.();
          break;
        case "t":
          if (window.innerWidth < 1000) api?.expand?.();
          else api?.collapse?.();
          break;
        case "escape":
          if (atFullscreen()) api?.exitFullscreen?.();
          else api?.collapse?.();
          break;
        default:
          return;
      }
      wake();
    },
    [togglePlay, wake],
  );

  useEffect(() => {
    const off = api?.onKey?.(handleKey);
    const onDocKey = (e: KeyboardEvent) => handleKey(e.key);
    document.addEventListener("keydown", onDocKey);
    return () => {
      off?.();
      document.removeEventListener("keydown", onDocKey);
    };
  }, [handleKey]);

  const volPct = Math.round((muted ? 0 : volume) * 100);

  // Mini preview: no controls except ✕ (stop); clicking anywhere enters theater.
  // The white hover border lives in CSS (.mini-overlay).
  if (mini) {
    return (
      <div
        className="mini-overlay"
        data-interactive
        onClick={() => api?.expand?.()}
      >
        {loading && <LoadingGlyph />}
        <button
          className="mini-overlay__close"
          type="button"
          aria-label="Stop"
          data-interactive
          onClick={(e) => {
            e.stopPropagation();
            api?.close();
          }}
        >
          <CloseIcon size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className={"theater-overlay" + (active ? " player--active" : "")}>
      {loading && <LoadingGlyph />}
      <div className="theater-topright" data-interactive>
        <button
          className="player__theater-exit"
          type="button"
          aria-label="Pop out"
          data-interactive
          onClick={() => api?.popout?.()}
        >
          <PopoutIcon size={20} />
        </button>
        <button
          className="player__theater-exit"
          type="button"
          aria-label={fs ? "Exit fullscreen" : "Fullscreen"}
          data-interactive
          onClick={() => (fs ? api?.exitFullscreen?.() : api?.fullscreen?.())}
        >
          {fs ? <ExitFullscreenIcon size={20} /> : <FullscreenIcon size={20} />}
        </button>
        <button
          className="player__theater-exit"
          type="button"
          aria-label={fs ? "Exit fullscreen" : "Exit theater"}
          data-interactive
          onClick={() =>
            fs
              ? api?.exitFullscreen?.()
              : api?.collapse
                ? api.collapse()
                : api?.close()
          }
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="theater-bar" data-interactive>
        {meta && (
          <div className="theater-bar__meta">
            {meta.logo && <img className="theater-bar__art" src={meta.logo} alt="" />}
            <div className="theater-bar__text">
              <p className="theater-bar__chan">
                <span className="theater-bar__name">{meta.channelName}</span>
                {meta.sourceName && (
                  <span className="theater-bar__source">{meta.sourceName}</span>
                )}
              </p>
              <h2 className="theater-bar__title">{meta.title}</h2>
              {meta.description && (
                <p className="theater-bar__desc">{meta.description}</p>
              )}
            </div>
          </div>
        )}

        <div className="theater-seek">
          <div className="theater-seek__track">
            <div
              className="theater-seek__fill"
              style={{ width: `${Math.min(100, meta?.progressPct ?? 100)}%` }}
            />
            <span
              className="theater-seek__knob"
              style={{ left: `${Math.min(100, meta?.progressPct ?? 100)}%` }}
            />
          </div>
          <div className="theater-seek__labels">
            <span>{meta?.startLabel ?? ""}</span>
            <span className="theater-seek__live">LIVE</span>
          </div>
        </div>

        <div className="theater-controls">
          <div className="theater-controls__group">
            <button className="player__btn" type="button" onClick={() => api?.seek(-10)} aria-label="Back 10 seconds">
              <SkipBackIcon size={24} />
            </button>
            <button className="player__btn player__btn--play" type="button" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
              {paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
            </button>
            <button className="player__btn" type="button" onClick={() => api?.seek(10)} aria-label="Forward 10 seconds">
              <SkipFwdIcon size={24} />
            </button>
          </div>

          <div className="theater-controls__group">
            <div className="theater-vol">
              <button className="player__btn" type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
                {muted || volPct === 0 ? <MuteIcon size={20} /> : <VolumeIcon size={20} />}
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
