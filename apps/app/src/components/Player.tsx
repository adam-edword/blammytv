import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  isDesktop,
  transcodeStart,
  transcodeStop,
  mpvSpike,
  mpvRenderProbe,
  mpvCanvasSetPause,
  mpvCanvasSetMute,
  mpvCanvasSetVolume,
  mpvCanvasSeek,
  type SourceStats,
} from "../lib/desktop";
import { StatsOverlay } from "./StatsOverlay";
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
  StatsIcon,
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
 * Live video player.
 *
 * On the desktop the stream is transcoded locally (ffmpeg → HLS, AC3 → AAC) and
 * played here; in a plain browser we just try the URL directly. It's a normal
 * web <video>, so it lives in the mini-player and expands for theater — and the
 * custom control bar adds theater / pop-out (native mpv) on top of the basics.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const idleRef = useRef<number>(0);

  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");
  const [message, setMessage] = useState("Tuning in…");
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [sourceStats, setSourceStats] = useState<SourceStats | null>(null);
  const [volHud, setVolHud] = useState(false);
  const volHudRef = useRef<number>(0);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [mpvPaused, setMpvPaused] = useState(false);

  // Load the stream (transcode first on desktop), play via hls.js.
  useEffect(() => {
    let cancelled = false;
    let hls: Hls | null = null;
    const video = videoRef.current;
    if (!video) return;

    setStatus("loading");
    setMessage("Tuning in…");
    setSourceStats(null);

    const play = (src: string) => {
      if (cancelled || !video) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          liveSyncDurationCount: 3,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 600,
          levelLoadingMaxRetry: 8,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setStatus("error");
            setMessage("Couldn't play this stream.");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
      } else {
        setStatus("error");
        setMessage("HLS isn't supported here.");
        return;
      }
      void video.play().catch(() => {});
    };

    (async () => {
      if (isDesktop()) {
        const res = await transcodeStart(url);
        if (cancelled) return;
        if (!res?.ok || !res.url) {
          setStatus("error");
          setMessage(res?.error ?? "Couldn't start playback.");
          return;
        }
        setSourceStats(res.stats ?? null);
        play(res.url);
      } else {
        play(url);
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      hlsRef.current = null;
      if (isDesktop()) void transcodeStop();
    };
  }, [url]);

  // Volume / mute.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // While the libmpv canvas is up it owns video + audio, so pause the <video>
  // underneath (no echo, no double-decode). Resume it when the canvas closes.
  // Entering canvas mode starts from playing + syncs current volume/mute to mpv.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (canvasOpen) {
      v.pause();
      setMpvPaused(false);
      mpvCanvasSetVolume(volume);
      mpvCanvasSetMute(muted);
    } else {
      void v.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasOpen]);

  // In canvas mode, route volume/mute to mpv (it owns audio).
  useEffect(() => {
    if (!canvasOpen) return;
    mpvCanvasSetVolume(volume);
    mpvCanvasSetMute(muted);
  }, [canvasOpen, volume, muted]);

  // Track play/pause.
  useEffect(() => {
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
  }, []);

  const togglePlay = useCallback(() => {
    if (canvasOpen) {
      setMpvPaused((p) => {
        const next = !p;
        mpvCanvasSetPause(next);
        return next;
      });
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [canvasOpen]);

  // Best-effort skip within the (short) live buffer: back rewinds, forward
  // clamps to the live edge.
  const skip = useCallback(
    (delta: number) => {
      if (canvasOpen) {
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
    [canvasOpen],
  );

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }, []);

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
      <video
        ref={videoRef}
        className="player__video"
        autoPlay
        playsInline
        // In the mini player a click opens theater; in theater it toggles play.
        onClick={theater ? togglePlay : onToggleTheater}
        onPlaying={() => setStatus("playing")}
      />

      {status !== "playing" && (
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

      {theater && canvasOpen && (
        <MpvCanvas url={url} onClose={() => setCanvasOpen(false)} />
      )}

      {theater && (
        <>
          {statsOpen && (
            <StatsOverlay
              onClose={() => setStatsOpen(false)}
              source={sourceStats}
              videoRef={videoRef}
              hlsRef={hlsRef}
              channelName={meta?.channelName}
              streamId={meta?.streamId}
              epgId={meta?.epgId}
            />
          )}

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
                <button className="player__btn player__btn--play" type="button" onClick={togglePlay} aria-label={(canvasOpen ? mpvPaused : paused) ? "Play" : "Pause"}>
                  {(canvasOpen ? mpvPaused : paused) ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
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
                <button className={"player__btn" + (statsOpen ? " is-active" : "")} type="button" onClick={() => setStatsOpen((o) => !o)} aria-label="Stats for nerds">
                  <StatsIcon size={20} />
                </button>
                {/* TEMP — Phase 1 libmpv spike: play the source in mpv's own window. */}
                {isDesktop() && (
                  <button
                    className="player__btn"
                    type="button"
                    onClick={() =>
                      void mpvSpike(url)?.then((res) => {
                        if (res && !res.ok) {
                          console.error("[mpv spike]", res.error);
                          window.alert("libmpv spike failed: " + res.error);
                        }
                      })
                    }
                    aria-label="libmpv spike (test)"
                    title="libmpv spike"
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>MPV</span>
                  </button>
                )}
                {/* TEMP — Phase 2 step 1: render one frame offscreen → BMP. */}
                {isDesktop() && (
                  <button
                    className="player__btn"
                    type="button"
                    onClick={() =>
                      void mpvRenderProbe(url)?.then((res) => {
                        if (res && !res.ok) {
                          console.error("[mpv probe]", res.error);
                          window.alert("render probe failed: " + res.error);
                        }
                      })
                    }
                    aria-label="libmpv render probe (test)"
                    title="libmpv render probe"
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>RP</span>
                  </button>
                )}
                {/* TEMP — Phase 2 step 2: live libmpv → canvas overlay. */}
                {isDesktop() && (
                  <button
                    className={"player__btn" + (canvasOpen ? " is-active" : "")}
                    type="button"
                    onClick={() => setCanvasOpen((o) => !o)}
                    aria-label="libmpv canvas (test)"
                    title="libmpv canvas"
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>CV</span>
                  </button>
                )}
                {onPopout && (
                  <button className="player__btn" type="button" onClick={onPopout} aria-label="Pop out (native player)">
                    <PopoutIcon size={20} />
                  </button>
                )}
                <button className="player__btn" type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
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
