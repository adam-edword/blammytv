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

/** Max volume as a multiplier — 2 = 200% (boost via Web Audio). */
const MAX_VOLUME = 2;

/**
 * Live video player with custom controls.
 *
 * Xtream live is MPEG-TS, demuxed by mpegts.js into a <video>. Audio is routed
 * through a Web Audio GainNode so the volume can go past 100% (HTML5 caps at
 * 100%). The gain feeds the speakers directly, so the boost survives even when
 * the picture is popped out to Picture-in-Picture.
 *
 * Cross-origin playback only works where CORS is disabled (the desktop shell);
 * in a plain browser we surface a small message.
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
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const idleRef = useRef<number>(0);

  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true); // controls visible

  // Web Audio graph — created once for this video element so volume > 100%
  // works (and keeps working in Picture-in-Picture).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      audioRef.current = { ctx, gain };
    } catch {
      /* Web Audio unavailable — fall back to element volume (0–100%). */
    }
    return () => {
      audioRef.current?.ctx.close().catch(() => {});
      audioRef.current = null;
    };
  }, []);

  // Apply volume / mute.
  useEffect(() => {
    const level = muted ? 0 : volume;
    const a = audioRef.current;
    if (a) {
      a.gain.gain.value = level;
      const v = videoRef.current;
      if (v) v.volume = 1;
    } else {
      const v = videoRef.current;
      if (v) v.volume = Math.min(1, level);
    }
  }, [volume, muted]);

  // (Re)create the mpegts player when the stream changes.
  useEffect(() => {
    setError(null);
    const video = videoRef.current;
    if (!video) return;
    if (!mpegts.getFeatureList().mseLivePlayback) {
      setError("Playback isn't supported here.");
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
    player.on(mpegts.Events.ERROR, () =>
      setError("Couldn't play this stream here (needs the desktop app)."),
    );
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

  // Track play/pause state from the element.
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
    audioRef.current?.ctx.resume().catch(() => {});
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

      {error && <div className="player__error">{error}</div>}

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
          className={"player__volume" + (volPct > 100 ? " player__volume--boost" : "")}
          type="range"
          min={0}
          max={MAX_VOLUME}
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
