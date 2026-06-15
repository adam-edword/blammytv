import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { isDesktop, transcodeStart, transcodeStop } from "../lib/desktop";

/**
 * Live video player.
 *
 * On the desktop the stream is transcoded locally (ffmpeg → HLS, AC3 audio → AAC)
 * and we play that HLS feed; in a plain browser we just try the URL directly.
 * Either way it's a normal web <video>, so it lives right in the mini-player and
 * can expand for theater — no native windows.
 */
export function Player({ url, className }: { url: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"loading" | "playing" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Tuning in…");

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
        video.src = src; // Safari / native HLS
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
        // Browser/demo: play the URL directly (mock streams won't resolve).
        play(url);
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      if (isDesktop()) void transcodeStop();
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
        onPlaying={() => setStatus("playing")}
      />
      {status !== "playing" && (
        <div className="player__status">
          {status === "loading" && <span className="player__spinner" />}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
