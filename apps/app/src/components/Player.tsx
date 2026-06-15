import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { isDesktop, transcodeStart, transcodeStop } from "../lib/desktop";
import {
  PlayIcon,
  PauseIcon,
  VolumeIcon,
  MuteIcon,
  PopoutIcon,
  TheaterIcon,
  FullscreenIcon,
} from "./icons";

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
}: {
  url: string;
  className?: string;
  theater?: boolean;
  onToggleTheater?: () => void;
  onPopout?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleRef = useRef<number>(0);

  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");
  const [message, setMessage] = useState("Tuning in…");
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true);

  // Load the stream (transcode first on desktop), play via hls.js.
  useEffect(() => {
    let cancelled = false;
    let hls: Hls | null = null;
    const video = videoRef.current;
    if (!video) return;

    setStatus("loading");
    setMessage("Tuning in…");

    const play = (src: string) => {
      if (cancelled || !video) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          liveSyncDurationCount: 3,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 600,
          levelLoadingMaxRetry: 8,
        });
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
        play(res.url);
      } else {
        play(url);
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      if (isDesktop()) void transcodeStop();
    };
  }, [url]);

  // Volume / mute.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = muted ? 0 : volume;
  }, [volume, muted]);

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
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

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

  const volPct = Math.round((muted ? 0 : volume) * 100);

  return (
    <div
      ref={wrapRef}
      className={"player " + (className ?? "") + (active ? " player--active" : "")}
      onMouseMove={wake}
      onMouseLeave={() => setActive(false)}
    >
      <video
        ref={videoRef}
        className="player__video"
        autoPlay
        playsInline
        onClick={togglePlay}
        onPlaying={() => setStatus("playing")}
      />

      {status !== "playing" && (
        <div className="player__status">
          {status === "loading" && <span className="player__spinner" />}
          <span>{message}</span>
        </div>
      )}

      {theater && (
        <button
          className="player__theater-exit"
          type="button"
          aria-label="Exit theater mode"
          onClick={onToggleTheater}
        >
          ✕
        </button>
      )}

      {status === "playing" && (
        <div className="player__controls">
          <button className="player__btn" type="button" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
            {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
          </button>
          <button className="player__btn" type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
            {muted || volPct === 0 ? <MuteIcon size={20} /> : <VolumeIcon size={20} />}
          </button>
          <input
            className="player__volume"
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
          <span className="player__vol-label">{volPct}%</span>

          <div className="player__spacer" />

          {onPopout && (
            <button className="player__btn" type="button" onClick={onPopout} aria-label="Pop out (native player)">
              <PopoutIcon size={20} />
            </button>
          )}
          {onToggleTheater && (
            <button className={"player__btn" + (theater ? " is-active" : "")} type="button" onClick={onToggleTheater} aria-label="Theater mode">
              <TheaterIcon size={20} />
            </button>
          )}
          <button className="player__btn" type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
            <FullscreenIcon size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
