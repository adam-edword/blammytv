import { useCallback, useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";
import {
  PlayIcon,
  PauseIcon,
  VolumeIcon,
  MuteIcon,
  PipIcon,
  TheaterIcon,
  FullscreenIcon,
} from "./icons";

/**
 * Live video player with custom controls.
 *
 * Xtream live is MPEG-TS, demuxed by mpegts.js into a <video>. Volume uses the
 * element's native volume (0–100%); a >100% boost via Web Audio is deferred —
 * it needs careful gesture/context handling so it doesn't kill the audio.
 *
 * Cross-origin playback only works where CORS is disabled (the desktop shell);
 * in a plain browser the stream never starts and we surface a small message.
 */
export function Player({
  url,
  theater,
  onToggleTheater,
}: {
  url: string;
  theater: boolean;
  onToggleTheater: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleRef = useRef<number>(0);

  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true); // controls visible

  // Apply volume / mute to the element.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // (Re)create the mpegts player when the stream changes.
  useEffect(() => {
    setError(false);
    setStarted(false);
    const video = videoRef.current;
    if (!video) return;
    if (!mpegts.getFeatureList().mseLivePlayback) {
      setError(true);
      return;
    }
    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: true, url },
      {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 1024 * 384,
        liveBufferLatencyChasing: false,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
      },
    );
    player.attachMediaElement(video);
    // Only treat an error as fatal if playback never started — mpegts emits
    // recoverable errors mid-stream that shouldn't cover a working picture.
    player.on(mpegts.Events.ERROR, () => setError(true));
    player.load();
    void Promise.resolve(player.play()).catch(() => {});
    return () => {
      try {
        player.destroy();
      } catch {
        /* already torn down */
      }
    };
  }, [url]);

  // Track element state: clear the error overlay once it's actually playing.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onPlaying = () => {
      setStarted(true);
      setError(false);
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("playing", onPlaying);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("playing", onPlaying);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* PiP unavailable */
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }, []);

  // Auto-hide controls when the pointer goes idle.
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
      className={"player" + (active ? " player--active" : "")}
      onMouseMove={wake}
      onMouseLeave={() => setActive(false)}
    >
      <video
        ref={videoRef}
        className="player__video"
        autoPlay
        playsInline
        onClick={togglePlay}
      />

      {error && !started && (
        <div className="player__error">
          Couldn't play this stream here (needs the desktop app).
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

        <button className="player__btn" type="button" onClick={togglePip} aria-label="Pop out (picture-in-picture)">
          <PipIcon size={20} />
        </button>
        <button className={"player__btn" + (theater ? " is-active" : "")} type="button" onClick={onToggleTheater} aria-label="Theater mode">
          <TheaterIcon size={20} />
        </button>
        <button className="player__btn" type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
          <FullscreenIcon size={20} />
        </button>
      </div>
    </div>
  );
}
