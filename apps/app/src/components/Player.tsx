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
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const idleRef = useRef<number>(0);

  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true); // controls visible

  // Apply a level (0–MAX) to the right place: the Web Audio gain once boost has
  // engaged, otherwise the element's own volume (capped at 100%).
  const applyLevel = useCallback((level: number) => {
    const v = videoRef.current;
    if (gainRef.current) {
      gainRef.current.gain.value = level;
      if (v) v.volume = 1;
    } else if (v) {
      v.volume = Math.min(1, level);
    }
  }, []);

  /**
   * Lazily route the element's audio through a Web Audio GainNode so volume can
   * exceed 100%. Done on demand (and only when boosting) because connecting a
   * MediaElementSource to a still-suspended context stalls playback — so we
   * create + resume it inside the user gesture that bumps volume past 100%.
   */
  const ensureBoostGraph = useCallback(() => {
    if (gainRef.current || !videoRef.current) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(videoRef.current);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      ctxRef.current = ctx;
      gainRef.current = gain;
      void ctx.resume().catch(() => {});
    } catch {
      /* Web Audio unavailable — stay on element volume (max 100%). */
    }
  }, []);

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      gainRef.current = null;
    };
  }, []);

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
    ctxRef.current?.resume().catch(() => {});
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const setVol = useCallback(
    (val: number) => {
      setMuted(false);
      if (val > 1) ensureBoostGraph();
      applyLevel(val);
      setVolume(val);
    },
    [applyLevel, ensureBoostGraph],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      applyLevel(next ? 0 : volume);
      return next;
    });
  }, [applyLevel, volume]);

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

        <button className="player__btn" type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted || volPct === 0 ? <MuteIcon size={20} /> : <VolumeIcon size={20} />}
        </button>

        <input
          className={"player__volume" + (volPct > 100 ? " player__volume--boost" : "")}
          type="range"
          min={0}
          max={MAX_VOLUME}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => setVol(parseFloat(e.target.value))}
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
