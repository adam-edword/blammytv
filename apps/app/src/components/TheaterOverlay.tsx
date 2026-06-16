import { useCallback, useEffect, useRef, useState } from "react";
import type { TheaterMeta } from "./Player";
import {
  PlayIcon,
  PauseIcon,
  VolumeIcon,
  MuteIcon,
  CloseIcon,
  SkipBackIcon,
  SkipFwdIcon,
} from "./icons";

/** Bridge exposed by overlay-preload.cjs (native theater window). */
interface OverlayApi {
  close: () => void;
  setPause: (paused: boolean) => void;
  setMute: (muted: boolean) => void;
  setVolume: (vol: number) => void; // 0..100 (mpv scale)
  seek: (delta: number) => void;
  setMouseIgnore: (ignore: boolean) => void;
  getMeta: () => Promise<TheaterMeta | null>;
  onMeta: (cb: (meta: TheaterMeta | null) => void) => () => void;
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

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setActive(false), 2800);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") api?.close();
      if (e.key === " ") togglePlay();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("keydown", onKey);
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

  const volPct = Math.round((muted ? 0 : volume) * 100);

  return (
    <div className={"theater-overlay" + (active ? " player--active" : "")}>
      <button
        className="player__theater-exit"
        type="button"
        aria-label="Exit theater"
        data-interactive
        onClick={() => api?.close()}
      >
        <CloseIcon size={20} />
      </button>

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
