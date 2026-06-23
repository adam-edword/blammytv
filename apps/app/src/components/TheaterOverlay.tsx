import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  LanguageIcon,
  CcIcon,
  ListIcon,
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
  seekTo?: (pos: number) => void; // absolute, seconds (VOD scrub)
  expand?: () => void; // mini → theater
  collapse?: () => void; // theater → mini
  fullscreen?: () => void; // theater → fullscreen
  exitFullscreen?: () => void; // fullscreen → theater
  popout?: () => void; // pop into mpv's own floating window
  panel?: () => void; // toggle the episodes/sources side panel (VOD)
  setMouseIgnore: (ignore: boolean) => void;
  getMeta: () => Promise<TheaterMeta | null>;
  onMeta: (cb: (meta: TheaterMeta | null) => void) => () => void;
  getLoading?: () => boolean;
  onLoading?: (cb: (loading: boolean) => void) => () => void;
  onKey?: (cb: (key: string) => void) => () => void;
  getTime?: () => PlayTime | null;
  onTime?: (cb: (t: PlayTime | null) => void) => () => void;
  selectAudio?: (id: string | number) => void;
  selectSub?: (id: string | number) => void;
  setSpeed?: (speed: number) => void;
  getTracks?: () => TrackMsg | null;
  onTracks?: (cb: (t: TrackMsg | null) => void) => () => void;
}

/** mpv playback position + total, in seconds (VOD only). */
interface PlayTime {
  pos: number;
  dur: number;
}

/** An audio or subtitle track option from mpv's track list. */
interface TrackOpt {
  id: number;
  label: string;
  lang?: string;
  selected: boolean;
}
interface TrackMsg {
  audio: TrackOpt[];
  subs: TrackOpt[];
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** "1:23:45" / "4:05" from seconds. */
function fmtTime(s?: number): string {
  if (s == null || !Number.isFinite(s)) return "0:00";
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
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
  // VOD owns its OS-fullscreen intent locally (the window-size heuristic can't
  // tell maximized from fullscreen). Starts windowed-fill.
  const [vodFs, setVodFs] = useState(false);
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

  // Playback position + duration for the VOD scrubber (live reports none).
  const [time, setTime] = useState<PlayTime | null>(() => api?.getTime?.() ?? null);
  useEffect(() => {
    const off = api?.onTime?.((t) => setTime(t));
    return () => off?.();
  }, []);

  // VOD scrub: fraction (0..1) while dragging, and the hover fraction for the
  // preview bubble. `draggingRef` tracks the drag across rapid pointer events.
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const fracFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  // Audio / subtitle tracks + playback speed (VOD).
  const [tracks, setTracks] = useState<TrackMsg | null>(
    () => api?.getTracks?.() ?? null,
  );
  useEffect(() => {
    const off = api?.onTracks?.((t) => setTracks(t));
    return () => off?.();
  }, []);
  const [speed, setSpeed] = useState(1);
  const [menu, setMenu] = useState<null | "audio" | "subs" | "speed">(null);
  const menuRef = useRef<string | null>(null);
  menuRef.current = menu;

  // On-demand playback swaps the chrome: no LIVE scrubber, ✕ stops outright,
  // and there's no mini/theater/fullscreen dance (it opens fullscreen).
  const isVod = meta?.kind === "vod";

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

  // Fullscreen toggle. Live uses the window-size heuristic; VOD tracks its own
  // intent (the main webview mirrors the comp-fullscreen events to the OS).
  const toggleFullscreen = useCallback(() => {
    if (isVod) {
      setVodFs((on) => {
        if (on) api?.exitFullscreen?.();
        else api?.fullscreen?.();
        return !on;
      });
    } else if (atFullscreen()) {
      api?.exitFullscreen?.();
    } else {
      api?.fullscreen?.();
    }
  }, [isVod]);

  const fullscreenOn = isVod ? vodFs : fs;

  // YouTube-style shortcuts. Volume/mute drive mpv via the volume effect; seek
  // and mode changes go straight through the bridge. Runs whether the key was
  // captured by the main webview (forwarded via onKey) or hit the overlay direct.
  const handleKey = useCallback(
    (key: string) => {
      const k = key.toLowerCase();
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
          toggleFullscreen();
          break;
        case "t":
          if (isVod) break;
          if (window.innerWidth < 1000) api?.expand?.();
          else api?.collapse?.();
          break;
        case "escape":
          if (isVod) api?.close();
          else if (atFullscreen()) api?.exitFullscreen?.();
          else api?.collapse?.();
          break;
        default:
          return;
      }
      wake();
    },
    [isVod, toggleFullscreen, togglePlay, wake],
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
  const playPct = time && time.dur ? Math.min(100, (time.pos / time.dur) * 100) : 0;
  // While dragging, the fill follows the finger, not mpv's reported position.
  const displayPct = scrubFrac != null ? scrubFrac * 100 : playPct;
  const audioTracks = tracks?.audio ?? [];
  const subTracks = tracks?.subs ?? [];
  const subOff = !subTracks.some((t) => t.selected);

  // Mini preview: no controls except ✕ (stop); clicking anywhere enters theater.
  // The white hover border lives in CSS (.mini-overlay). VOD never goes mini.
  if (mini && !isVod) {
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
    <div
      className={"theater-overlay" + (active ? " player--active" : "")}
      onClick={(e) => {
        // An open menu? Any click just dismisses it (no pause).
        if (menuRef.current) {
          setMenu(null);
          return;
        }
        // Click the picture (not a control) to play/pause, like YouTube.
        if (!(e.target as Element).closest("[data-interactive]")) {
          togglePlay();
          wake();
        }
      }}
    >
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
          aria-label={fullscreenOn ? "Exit fullscreen" : "Fullscreen"}
          data-interactive
          onClick={toggleFullscreen}
        >
          {fullscreenOn ? (
            <ExitFullscreenIcon size={20} />
          ) : (
            <FullscreenIcon size={20} />
          )}
        </button>
        <button
          className="player__theater-exit"
          type="button"
          aria-label={isVod ? "Stop" : fs ? "Exit fullscreen" : "Exit theater"}
          data-interactive
          onClick={() =>
            isVod
              ? api?.close()
              : fs
                ? api?.exitFullscreen?.()
                : api?.collapse
                  ? api.collapse()
                  : api?.close()
          }
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="theater-bar">
        {meta && (
          <div className="theater-bar__meta">
            {meta.logo && (
              <img
                className={
                  "theater-bar__art" + (isVod ? " theater-bar__art--logo" : "")
                }
                src={meta.logo}
                alt=""
              />
            )}
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

        {isVod ? (
          <div className="theater-seek" data-interactive>
            <div
              className="theater-seek__track theater-seek__track--seekable"
              onPointerDown={(e) => {
                if (!time?.dur) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                draggingRef.current = true;
                const f = fracFromEvent(e);
                setScrubFrac(f);
                setHoverFrac(f);
              }}
              onPointerMove={(e) => {
                if (!time?.dur) return;
                const f = fracFromEvent(e);
                setHoverFrac(f);
                if (draggingRef.current) setScrubFrac(f);
              }}
              onPointerUp={(e) => {
                if (!draggingRef.current) return;
                draggingRef.current = false;
                const f = fracFromEvent(e);
                if (time?.dur) api?.seekTo?.(f * time.dur);
                setScrubFrac(null);
              }}
              onPointerLeave={() => {
                if (!draggingRef.current) setHoverFrac(null);
              }}
            >
              <div
                className="theater-seek__fill"
                style={{ width: `${displayPct}%` }}
              />
              <span
                className="theater-seek__knob"
                style={{ left: `${displayPct}%` }}
              />
              {hoverFrac != null && time?.dur != null && (
                <div
                  className="scrub-preview"
                  style={{ left: `${hoverFrac * 100}%` }}
                >
                  <span className="scrub-preview__time">
                    {fmtTime(hoverFrac * time.dur)}
                  </span>
                </div>
              )}
            </div>
            <div className="theater-seek__labels">
              <span>{fmtTime(time?.pos)}</span>
              <span>{fmtTime(time?.dur)}</span>
            </div>
          </div>
        ) : (
          <div className="theater-seek" data-interactive>
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
        )}

        <div className="theater-controls" data-interactive>
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
            {isVod && (
              <>
                <button
                  className="player__btn"
                  type="button"
                  aria-label="Episodes & sources"
                  onClick={() => api?.panel?.()}
                >
                  <ListIcon size={20} />
                </button>
                <div className="theater-menu-wrap">
                  <button
                    className="player__btn"
                    type="button"
                    aria-label="Audio track"
                    onClick={() =>
                      setMenu((m) => (m === "audio" ? null : "audio"))
                    }
                  >
                    <LanguageIcon size={20} />
                  </button>
                  {menu === "audio" && (
                    <div className="track-menu">
                      {audioTracks.length === 0 ? (
                        <span className="track-menu__empty">No tracks</span>
                      ) : (
                        audioTracks.map((t) => (
                          <button
                            key={t.id}
                            className={
                              "track-menu__item" +
                              (t.selected ? " is-active" : "")
                            }
                            type="button"
                            onClick={() => {
                              api?.selectAudio?.(t.id);
                              setMenu(null);
                            }}
                          >
                            {t.label}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="theater-menu-wrap">
                  <button
                    className="player__btn"
                    type="button"
                    aria-label="Subtitles"
                    onClick={() =>
                      setMenu((m) => (m === "subs" ? null : "subs"))
                    }
                  >
                    <CcIcon size={20} />
                  </button>
                  {menu === "subs" && (
                    <div className="track-menu">
                      <button
                        className={
                          "track-menu__item" + (subOff ? " is-active" : "")
                        }
                        type="button"
                        onClick={() => {
                          api?.selectSub?.("no");
                          setMenu(null);
                        }}
                      >
                        Off
                      </button>
                      {subTracks.map((t) => (
                        <button
                          key={t.id}
                          className={
                            "track-menu__item" +
                            (t.selected ? " is-active" : "")
                          }
                          type="button"
                          onClick={() => {
                            api?.selectSub?.(t.id);
                            setMenu(null);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="theater-menu-wrap">
                  <button
                    className="player__btn player__btn--speed"
                    type="button"
                    aria-label="Playback speed"
                    onClick={() =>
                      setMenu((m) => (m === "speed" ? null : "speed"))
                    }
                  >
                    {speed}×
                  </button>
                  {menu === "speed" && (
                    <div className="track-menu">
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          className={
                            "track-menu__item" + (s === speed ? " is-active" : "")
                          }
                          type="button"
                          onClick={() => {
                            api?.setSpeed?.(s);
                            setSpeed(s);
                            setMenu(null);
                          }}
                        >
                          {s}×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
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
