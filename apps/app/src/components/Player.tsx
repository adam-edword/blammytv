import { useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";

/**
 * Live video player. Xtream live feeds are MPEG-TS over HTTP, which browsers
 * can't decode natively, so we demux with mpegts.js into a <video> element.
 *
 * Cross-origin playback only works where CORS is disabled — i.e. inside the
 * desktop (Electron) shell. In a plain browser the stream fetch is blocked and
 * we surface a small message instead.
 */
export function Player({ url, className }: { url: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether playback has actually started — mpegts emits recoverable errors
  // mid-stream, so we only surface the message if the picture never started.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setError(null);
    setStarted(false);
    const video = videoRef.current;
    if (!video) return;

    if (!mpegts.getFeatureList().mseLivePlayback) {
      setError("Playback isn't supported here.");
      return;
    }

    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: true, url },
      {
        // Smooth playback over low latency — the right trade for watching TV.
        // A stash buffer absorbs network jitter; NOT chasing the live edge
        // avoids the constant little seeks that show up as stutter/buffering.
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

  return (
    <div className={"player " + (className ?? "")}>
      <video
        ref={videoRef}
        className="player__video"
        autoPlay
        playsInline
        controls
        onPlaying={() => {
          setStarted(true);
          setError(null);
        }}
      />
      {error && !started && <div className="player__error">{error}</div>}
    </div>
  );
}
