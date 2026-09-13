import { useEffect, useRef, useState } from "react";

/**
 * One tile of the multi-view grid: a `<video>` with a demuxer bolted to it.
 *
 * THE WHOLE REASON THIS IS NOT JUST `<video src>`. Live Xtream URLs are raw
 * MPEG-TS (`stream.ts` builds `…/{id}.ts`, and playlists.ts records that as
 * "what nearly every Xtream panel serves"). Chromium has no MPEG-TS demuxer
 * and no native HLS, so a plain video element fails on EVERY live stream,
 * not some of them. mpegts.js transmuxes the TS into fragmented MP4 and
 * feeds it through Media Source Extensions; hls.js does the same job for
 * the `.m3u8` minority.
 *
 * That is also why the notice exists: MSE means the BROWSER's codec support
 * is the ceiling. Measured on Adam's machine 2026-09-13, H.264 + AAC plays,
 * AC-3 and E-AC-3 play, HEVC does not.
 *
 * NO PROXY. mpegts.js reads over XHR, so this only works where the panel
 * sends Access-Control-Allow-Origin. Adam's does (btvMultiview: 200
 * video/mp2t, CORS allowed). Another provider may not, and that is what
 * `error` is for: the tile says so rather than sitting black.
 */

/** How a URL has to be played, from its extension alone. */
function kindOf(url: string): "hls" | "ts" {
  return /\.m3u8(\?|$)/i.test(url) ? "hls" : "ts";
}

export function MultiviewTile({
  url,
  name,
  focused,
  onFocus,
}: {
  url: string;
  name: string;
  /** The one tile with sound. Exactly one, enforced by the grid. */
  focused: boolean;
  onFocus: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    setError(null);

    // Both libraries are loaded on demand rather than at module scope: a
    // viewer who never opens multi-view should not pay for a demuxer, and
    // the .m3u8 path should not drag in the TS one or the reverse.
    let destroy: (() => void) | undefined;
    void (async () => {
      try {
        if (kindOf(url) === "hls") {
          const Hls = (await import("hls.js")).default;
          if (disposed) return;
          // Safari plays HLS natively; everything else needs the library.
          // WebView2 is Chromium, so this is the branch that runs here.
          if (!Hls.isSupported()) {
            video.src = url;
            return;
          }
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setError("Stream failed");
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          destroy = () => hls.destroy();
          return;
        }
        const mpegts = (await import("mpegts.js")).default;
        if (disposed) return;
        if (!mpegts.isSupported()) {
          setError("This build can’t play MPEG-TS");
          return;
        }
        const player = mpegts.createPlayer(
          { type: "mpegts", isLive: true, url },
          // A live tile that buffers ahead is a live tile running behind, and
          // four of them drift apart from each other. These are mpegts.js's
          // own live-sync controls.
          { enableStashBuffer: false, liveBufferLatencyChasing: true },
        );
        player.on(mpegts.Events.ERROR, () => setError("Stream failed"));
        player.attachMediaElement(video);
        player.load();
        destroy = () => {
          player.destroy();
        };
      } catch {
        if (!disposed) setError("Stream failed");
      }
    })();

    return () => {
      disposed = true;
      // Destroy before the element goes: a demuxer still appending to a
      // detached media source is how a closed tile keeps its connection.
      destroy?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);

  // Audio follows focus rather than being set at mount, so moving focus does
  // not restart a stream. Exactly one tile is ever unmuted; the grid owns
  // that invariant and this just obeys it.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = !focused;
  }, [focused]);

  return (
    <button
      type="button"
      className={"mvtile" + (focused ? " is-on" : "")}
      onClick={onFocus}
      aria-pressed={focused}
      aria-label={focused ? `${name}, playing audio` : `${name}, muted`}
    >
      <video
        ref={videoRef}
        className="mvtile__video"
        playsInline
        autoPlay
        muted
      />
      <span className="mvtile__name">{name}</span>
      {error && <span className="mvtile__error">{error}</span>}
    </button>
  );
}
