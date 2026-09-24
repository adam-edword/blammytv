import { useEffect, useRef, useState, type CSSProperties } from "react";
import { scrubbedMessage } from "../../lib/errors";
import { isTauri, tauriMvProxyClose, tauriMvProxyOpen } from "../../lib/tauri";
import {
  getMvProfile,
  mpegtsConfig,
  onMvProfileChange,
  registerTile,
} from "./multiviewTuning";

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
 * THROUGH THE NATIVE PROXY, in the shell (v0.9.101). mpegts.js reads with
 * fetch, so a provider has to send Access-Control-Allow-Origin, and Adam's
 * stopped: on 2026-09-13 it answered 200 with CORS allowed, and on his first
 * real multi-view run every tile died on a 302 with no header, Cartoon
 * Network included. mvproxy.rs fetches on the Rust side, follows the
 * redirect and adds the header, and the tile reads from 127.0.0.1. The
 * .m3u8 path still goes direct: proxying HLS means rewriting every playlist
 * the stream hands back, and his panel serves .ts.
 *
 * PLACED, NOT FLOWED (plan 017). The grid hands each tile its rect from
 * mvLayout and the tile goes exactly there, so a layout change moves the
 * element instead of re-creating it: the stream keeps playing through it.
 * The name is not drawn here any more; it is the caption under the picture.
 */

/**
 * One console line per dead tile, saying WHY. The tile itself only says
 * "Stream failed", and on Adam's first real run (v0.9.99) both tiles did,
 * with nothing to tell a codec the browser refuses (HEVC, by the notice's
 * own warning) from a channel that is simply off air or a panel that said
 * no. Both libraries know which it was; this keeps what they said.
 *
 * NEVER THE URL: an Xtream live URL carries the username and password in
 * its path. Free text from the libraries goes through scrubbedMessage, which
 * cuts any URL down to its origin.
 */
function logFailure(name: string, what: string, codecs: string): void {
  console.warn(
    `[mv] "${name}" failed: ${scrubbedMessage(what)}` +
      (codecs ? ` | stream: ${codecs}` : " | codecs never reported"),
  );
}

/** How a URL has to be played, from its extension alone. */
function kindOf(url: string): "hls" | "ts" {
  return /\.m3u8(\?|$)/i.test(url) ? "hls" : "ts";
}

export function MultiviewTile({
  url,
  name,
  focused,
  onFocus,
  style,
}: {
  url: string;
  name: string;
  /** The one tile with sound. Exactly one, enforced by the grid. */
  focused: boolean;
  onFocus: () => void;
  /** Where the picture goes, from mvLayout. */
  style?: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The buffering profile (multiviewTuning.ts). A change re-creates the
  // player, so btvMultiviewTune can A/B it on streams that are playing.
  const [profile, setProfile] = useState(getMvProfile);
  useEffect(() => onMvProfileChange(setProfile), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    setError(null);

    // Both libraries are loaded on demand rather than at module scope: a
    // viewer who never opens multi-view should not pay for a demuxer, and
    // the .m3u8 path should not drag in the TS one or the reverse.
    let destroy: (() => void) | undefined;
    // What the stream turned out to carry, once a library has looked. Read
    // by logFailure, so a codec refusal names the codec.
    let codecs = "";
    // The element's own verdict. MSE rejecting what it was fed lands here
    // as well as (sometimes instead of) in the library's error event.
    const onVideoError = () => {
      const err = video.error;
      if (!err || disposed) return;
      logFailure(name, `video element: code ${err.code} ${err.message}`, codecs);
      setError("Stream failed");
    };
    video.addEventListener("error", onVideoError);
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
          hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            const l = data.levels[0];
            if (l) codecs = [l.videoCodec, l.audioCodec].filter(Boolean).join(" + ");
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            logFailure(
              name,
              `hls.js ${data.type} / ${data.details}` +
                (data.response ? ` / HTTP ${data.response.code}` : "") +
                (data.error ? ` / ${data.error.message}` : ""),
              codecs,
            );
            setError("Stream failed");
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          const unregister = registerTile({ name, video, speed: () => undefined });
          destroy = () => {
            unregister();
            hls.destroy();
          };
          return;
        }
        const mpegts = (await import("mpegts.js")).default;
        if (disposed) return;
        if (!mpegts.isSupported()) {
          logFailure(name, "mpegts.js isSupported() is false: MSE has no H.264 here", codecs);
          setError("This build can’t play MPEG-TS");
          return;
        }
        // A native build from before the proxy has no such command; the
        // tile then tries the stream directly, as it always did.
        let proxied = "";
        if (isTauri()) {
          proxied = await tauriMvProxyOpen(url).catch(() => "");
          if (disposed) {
            if (proxied) void tauriMvProxyClose(proxied).catch(() => {});
            return;
          }
        }
        const player = mpegts.createPlayer(
          { type: "mpegts", isLive: true, url: proxied || url },
          mpegtsConfig(profile),
        );
        player.on(mpegts.Events.MEDIA_INFO, (info: { videoCodec?: string; audioCodec?: string }) => {
          codecs = [info.videoCodec, info.audioCodec].filter(Boolean).join(" + ");
        });
        player.on(
          mpegts.Events.ERROR,
          (type: string, detail: string, info?: { code?: number; msg?: string }) => {
            logFailure(
              name,
              `mpegts.js ${type} / ${detail}` +
                (info?.code != null && info.code !== -1 ? ` / code ${info.code}` : "") +
                (info?.msg ? ` / ${info.msg}` : ""),
              codecs,
            );
            setError("Stream failed");
          },
        );
        player.attachMediaElement(video);
        player.load();
        const unregister = registerTile({
          name,
          video,
          speed: () => (player.statisticsInfo as { speed?: number } | undefined)?.speed,
        });
        destroy = () => {
          unregister();
          player.destroy();
          if (proxied) void tauriMvProxyClose(proxied).catch(() => {});
        };
      } catch (e) {
        if (disposed) return;
        logFailure(name, `setup threw: ${e instanceof Error ? e.message : String(e)}`, codecs);
        setError("Stream failed");
      }
    })();

    return () => {
      disposed = true;
      video.removeEventListener("error", onVideoError);
      // Destroy before the element goes: a demuxer still appending to a
      // detached media source is how a closed tile keeps its connection.
      destroy?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, name, profile]);

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
      style={style}
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
      {error && <span className="mvtile__error">{error}</span>}
    </button>
  );
}
