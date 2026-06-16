import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  isDesktop,
  nativeTheaterOpen,
  nativeTheaterMeta,
  onTheaterClosed,
  mpvCanvasSetPause,
  mpvCanvasSetMute,
  mpvCanvasSetVolume,
  mpvCanvasSeek,
} from "../lib/desktop";
import { MpvCanvas } from "./MpvCanvas";
import {
  PlayIcon,
  PauseIcon,
  VolumeIcon,
  MuteIcon,
  PopoutIcon,
  FullscreenIcon,
  CloseIcon,
  SkipBackIcon,
  SkipFwdIcon,
  LanguageIcon,
  CcIcon,
} from "./icons";

/** Show content + live position shown in the theater overlay. */
export interface TheaterMeta {
  logo?: string;
  channelName: string;
  sourceName?: string;
  title: string;
  description?: string;
  startLabel?: string;
  progressPct: number;
  live: boolean;
  streamId?: string;
  epgId?: string;
}

/**
 * Live video player. libmpv is the engine on the desktop: the in-page mini +
 * theater render mpv to a <canvas> (decode at source res, read back at display
 * size), and Fullscreen swaps to the native mpv window + transparent overlay for
 * true 4K60. In a plain browser it falls back to a web <video> (HLS).
 */
export function Player({
  url,
  className,
  theater = false,
  onToggleTheater,
  onPopout,
  onStop,
  meta,
}: {
  url: string;
  className?: string;
  theater?: boolean;
  onToggleTheater?: () => void;
  onPopout?: () => void;
  onStop?: () => void;
  meta?: TheaterMeta;
}) {
  const onDesktop = isDesktop();
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleRef = useRef<number>(0);

  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");
  const [message, setMessage] = useState("Tuning in…");
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true);
  const [volHud, setVolHud] = useState(false);
  const volHudRef = useRef<number>(0);
  // Native fullscreen theater (desktop): mpv's own GPU window + HTML overlay.
  const [nativeFs, setNativeFs] = useState(false);

  // Browser fallback: load the stream into the <video> via hls.js.
  useEffect(() => {
    if (onDesktop) return;
    let cancelled = false;
    let hls: Hls | null = null;
    const video = videoRef.current;
    if (!video) return;
    setStatus("loading");
    setMessage("Tuning in…");
    if (Hls.isSupported()) {
      hls = new Hls({ liveSyncDurationCount: 3 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal && !cancelled) {
          setStatus("error");
          setMessage("Couldn't play this stream.");
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    }
    void video.play().catch(() => {});
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [url, onDesktop]);

  // Volume / mute → mpv (desktop) or the <video> (browser).
  useEffect(() => {
    if (onDesktop) {
      mpvCanvasSetVolume(volume);
      mpvCanvasSetMute(muted);
    } else {
      const v = videoRef.current;
      if (v) v.volume = muted ? 0 : volume;
    }
  }, [volume, muted, onDesktop]);

  // Browser: track the <video>'s play/pause for the transport icon.
  useEffect(() => {
    if (onDesktop) return;
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [onDesktop]);

  // Native fullscreen lifecycle: entering starts the native mpv window + overlay
  // (the canvas surface unmounts, freeing the single mpv handle); the overlay's
  // Close/Escape fires theater:closed, which brings us back to the canvas.
  useEffect(() => {
    if (!onDesktop) return;
    return onTheaterClosed(() => setNativeFs(false));
  }, [onDesktop]);

  useEffect(() => {
    if (!onDesktop || !nativeFs) return;
    void nativeTheaterOpen(url, meta)?.then((res) => {
      if (res && !res.ok) {
        console.error("[native theater]", res.error);
        setNativeFs(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeFs]);

  // Keep the overlay's show info fresh while native theater is open.
  useEffect(() => {
    if (onDesktop && nativeFs && meta) void nativeTheaterMeta(meta);
  }, [onDesktop, nativeFs, meta]);

  // A fresh surface (new channel, or returning from native fullscreen) starts
  // playing — keep the transport icon honest.
  useEffect(() => setPaused(false), [url, nativeFs]);

  const togglePlay = useCallback(() => {
    if (onDesktop) {
      setPaused((p) => {
        mpvCanvasSetPause(!p);
        return !p;
      });
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [onDesktop]);

  const skip = useCallback(
    (delta: number) => {
      if (onDesktop) {
        mpvCanvasSeek(delta);
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      try {
        const s = v.seekable;
        const min = s.length ? s.start(0) : 0;
        const max = s.length ? s.end(s.length - 1) : v.currentTime;
        v.currentTime = Math.min(max, Math.max(min, v.currentTime + delta));
      } catch {
        /* not seekable */
      }
    },
    [onDesktop],
  );

  // Fullscreen: native mpv theater on the desktop, browser fullscreen otherwise.
  const goFullscreen = useCallback(() => {
    if (onDesktop) {
      setNativeFs(true);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }, [onDesktop]);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setActive(false), 2800);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleRef.current);
  }, [wake]);

  // Scroll over the player to change volume (with a brief on-screen readout).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 0.05 : -0.05;
      setMuted(false);
      setVolume((v) => Math.min(1, Math.max(0, Math.round((v + step) * 100) / 100)));
      setVolHud(true);
      window.clearTimeout(volHudRef.current);
      volHudRef.current = window.setTimeout(() => setVolHud(false), 900);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(volHudRef.current);
    };
  }, []);

  const volPct = Math.round((muted ? 0 : volume) * 100);
  // While native fullscreen is up, the app window is hidden — render a calm
  // placeholder so the (paused) mini doesn't fight the native player.
  const surfaceHidden = onDesktop && nativeFs;

  return (
    <div
      ref={wrapRef}
      className={
        "player " +
        (className ?? "") +
        (theater ? " player--theater" : " player--mini") +
        (active ? " player--active" : "")
      }
      onMouseMove={wake}
      onMouseLeave={() => setActive(false)}
    >
      {surfaceHidden ? (
        <div className="player__video" />
      ) : onDesktop ? (
        <MpvCanvas
          url={url}
          className="player__video"
          onClick={theater ? togglePlay : onToggleTheater}
          onLive={() => setStatus("playing")}
          onError={(m) => {
            setStatus("error");
            setMessage(m);
          }}
        />
      ) : (
        <video
          ref={videoRef}
          className="player__video"
          autoPlay
          playsInline
          onClick={theater ? togglePlay : onToggleTheater}
          onPlaying={() => setStatus("playing")}
        />
      )}

      {status !== "playing" && !surfaceHidden && (
        <div className="player__status">
          {status === "loading" && <span className="player__spinner" />}
          <span>{message}</span>
        </div>
      )}

      <div className={"player__vol-hud" + (volHud ? " is-visible" : "")} aria-hidden="true">
        {volPct === 0 ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
        <span>{volPct}%</span>
      </div>

      {/* Mini player: a single Stop button, nothing else. */}
      {!theater && onStop && (
        <button
          className="player__stop"
          type="button"
          aria-label="Stop"
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
        >
          <CloseIcon size={20} />
        </button>
      )}

      {theater && (
        <>
          <button
            className="player__theater-exit"
            type="button"
            aria-label="Exit theater mode"
            onClick={() => {
              if (document.fullscreenElement)
                document.exitFullscreen().catch(() => {});
              onToggleTheater?.();
            }}
          >
            <CloseIcon size={20} />
          </button>

          <div className="theater-bar">
            {meta && (
              <div className="theater-bar__meta">
                {meta.logo && (
                  <img className="theater-bar__art" src={meta.logo} alt="" />
                )}
                <div className="theater-bar__text">
                  <p className="theater-bar__chan">
                    <span className="theater-bar__name">{meta.channelName}</span>
                    {meta.sourceName && (
                      <span className="theater-bar__source">
                        {meta.sourceName}
                      </span>
                    )}
                  </p>
                  <h2 className="theater-bar__title">{meta.title}</h2>
                  {meta.description && (
                    <p className="theater-bar__desc">{meta.description}</p>
                  )}
                </div>
              </div>
            )}

            {/* Live position (display only). */}
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
                <button className="player__btn" type="button" onClick={() => skip(-10)} aria-label="Back 10 seconds">
                  <SkipBackIcon size={24} />
                </button>
                <button className="player__btn player__btn--play" type="button" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
                  {paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
                </button>
                <button className="player__btn" type="button" onClick={() => skip(10)} aria-label="Forward 10 seconds">
                  <SkipFwdIcon size={24} />
                </button>
              </div>

              <div className="theater-controls__group">
                <button className="player__btn" type="button" disabled title="Audio language — coming soon" aria-label="Audio language">
                  <LanguageIcon size={20} />
                </button>
                <button className="player__btn" type="button" disabled title="Subtitles — coming soon" aria-label="Subtitles">
                  <CcIcon size={20} />
                </button>
                {onPopout && (
                  <button className="player__btn" type="button" onClick={onPopout} aria-label="Pop out (native player)">
                    <PopoutIcon size={20} />
                  </button>
                )}
                <button className="player__btn" type="button" onClick={goFullscreen} aria-label="Fullscreen">
                  <FullscreenIcon size={20} />
                </button>
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
        </>
      )}
    </div>
  );
}
