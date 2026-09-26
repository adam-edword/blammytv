import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { scrubbedMessage } from "../../lib/errors";
import { isTauri, tauriMvProxyClose, tauriMvProxyOpen } from "../../lib/tauri";
import {
  getMvProfile,
  hlsConfig,
  mpegtsConfig,
  onMvProfileChange,
  registerTile,
} from "./multiviewTuning";
import {
  airing,
  behindLabel,
  explainFailure,
  HEVC_MIME,
  unplayable,
  type Failure,
  type FailureFacts,
} from "./mvTile";
import { FROZEN_MS, mayReconnect, newWatch, spend, watchStep } from "./mvRecover";
import { progress } from "./epg";
import type { Programme } from "./model";
import type { Fixture } from "../sports/model";
import { scoreLine } from "./mvGames";
import { watchLevel, type LevelWatch } from "./mvLevel";
import { formatClock } from "../../lib/time";
import { loadClockFormat } from "../settings/clockFormat";
import { CloseIcon, PlayIcon, SwapIcon, VolumeIcon, WarnIcon } from "../../ui/icons";
import { Hint } from "../../ui/Hint";

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
 *
 * THE TILE SAYS WHAT IT IS (plan 017, P2). At rest nothing is on the
 * picture. Under the pointer, or with keyboard focus, it shows the channel,
 * what is on and its progress, whether it is live, and the tile's own
 * actions: close it, and move the sound here. It says when it is tuning,
 * when it has stalled, and when it has failed, why, in words taken from
 * what the proxy and the demuxer actually reported (mvTile.ts).
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

/** What a tile knows about its channel, for the info it shows. */
export interface TileChannel {
  name: string;
  number?: number;
  logo?: string;
}

/** A stall shorter than this is not worth a spinner. */
const STALL_MS = 1000;
/** How long the Sound badge stays after the sound moves (plan 017). */
const FLASH_MS = 3000;
/** A score this old says when it is from: ESPN has failed that long, and it
 * looked exactly like a live one (plan 018, L10). The board is asked every
 * 90 seconds, so this is three looks missed. */
const SCORE_STALE_MS = 5 * 60_000;

/**
 * The channel's logo, or its first letter when there is none or it broke.
 *
 * SIZED WITHOUT THE STYLESHEET. Provider logos come at their own size, and
 * Cartoon Network's is several hundred pixels: on Adam's first run of
 * v0.9.107 the page came back from a mid-pull reload with the new markup
 * and the old CSS, and each caption drew one at full size across the grid.
 * The box and the image carry their size themselves now, so a stylesheet
 * that is late, stale or missing cannot do that again.
 */
export function MvLogo({ channel, size }: { channel: TileChannel; size: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="mvlogo"
      style={{
        display: "inline-grid",
        overflow: "hidden",
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
      }}
      aria-hidden
    >
      {channel.logo && !broken ? (
        <img
          src={channel.logo}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        channel.name.trim()[0]
      )}
    </span>
  );
}

/** A button inside the tile: it acts, and does not also move the sound. */
const own =
  (fn: () => void) =>
  (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

export function MultiviewTile({
  url,
  unresolved,
  name,
  channel,
  programmes,
  game,
  scoreAt,
  now,
  focused,
  volume,
  muted,
  onFocus,
  onRemove,
  onReplace,
  onWatch,
  onVolumeStep,
  picking,
  onPick,
  onRetryResolve,
  onDead,
  gate,
  atCap,
  idle = false,
  style,
  mvId,
}: {
  /** The stream. Null while the channel's stream is still being looked
   * up; see `unresolved` for when that failed. */
  url: string | null;
  /** The lookup gave nothing: a channel the provider has no stream for. */
  unresolved?: boolean;
  /** What the tile is called: the game, or the channel. */
  name: string;
  /** The channel behind it, for its logo and number. */
  channel: TileChannel;
  /** Its guide, when it has one. */
  programmes?: Programme[];
  /** The game, when it was picked as one: the score and clock instead of
   * the guide (plan 017, "A tile"). */
  game?: Fixture;
  /** When that score came (Date.now()): past SCORE_STALE_MS it says so. */
  scoreAt?: number;
  /** The clock the grid ticks, for what is on and its progress. */
  now: Date;
  /** The one tile with sound. Exactly one, enforced by the grid. */
  focused: boolean;
  /** The bar's volume, 0 to 1, and its mute: for the sound tile. */
  volume: number;
  muted: boolean;
  onFocus: () => void;
  /** Close this stream (Adam's X). */
  onRemove: () => void;
  /** Swap it for another channel, in the same place (the picker). */
  onReplace: () => void;
  /** Watch in player: this channel in the main player (plan 017). */
  onWatch: () => void;
  /** The wheel over the sound tile: the bar's volume, up or down a step. */
  onVolumeStep: (step: number) => void;
  /** A channel sent from elsewhere waits for the tile it replaces (its
   * name): this tile is then a target, and a click, Space or Enter picks
   * it rather than taking the sound (plan 017, P6b). A failed tile too:
   * replacing one is the obvious use for it. */
  picking?: string | null;
  onPick?: () => void;
  /** Look the stream up again, after `unresolved`. */
  onRetryResolve: () => void;
  /** Whether it has failed: a failed tile can't take the sound, and the
   * grid's keys pass over it. */
  onDead?: (dead: boolean) => void;
  /** Before connecting again: waits for the line to have a slot, and its
   * turn after other tiles, and has the stream's link looked up afresh
   * (the tab's, plan 018 H1). Says while it waits on the line. */
  gate: (waiting: (on: boolean) => void) => Promise<void>;
  /** The line was full when this tile last looked: a refusal then is most
   * likely the limit, and says so (mvTile.explainFailure). */
  atCap: boolean;
  /** The tab has gone idle: the bar is dimmed, and hover shows nothing. */
  idle?: boolean;
  /** Where the picture goes, from mvLayout. */
  style?: CSSProperties;
  /** What the grid's motion knows this tile by (mvMotion.ts). */
  mvId?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The wheel over the sound tile is the volume (Adam, v0.9.120), a step a
  // notch as ↑ and ↓ are and as the Guide's player does, up also unmuting.
  // The sound tile only: over any other the wheel does nothing. A native
  // listener, since React's are passive and the page must not also scroll.
  const volumeStep = useRef(onVolumeStep);
  volumeStep.current = onVolumeStep;
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !focused) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      volumeStep.current(e.deltaY < 0 ? 0.05 : -0.05);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [focused]);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Before the first frame, the tile is tuning. */
  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);
  /** Seconds spent waiting on data since the first frame: with no catch-up,
   * exactly how far behind live the tile has fallen (mvTile.behindLabel). */
  const [stalledS, setStalledS] = useState(0);
  /** Bumped by a reconnect or Retry, which re-creates the player. */
  const [attempt, setAttempt] = useState(0);

  /**
   * GETTING IT BACK (plan 018, H1). A tile that was playing and loses its
   * stream reconnects by itself, MAX_TRIES times, the budget refilled by a
   * minute of picture (mvRecover.ts). It used to freeze on its last frame,
   * or show the failure and wait for a click, for the rest of the game.
   * Each try waits on the tab's gate first: a free slot on the line, its
   * turn, a fresh link.
   */
  const [recovering, setRecovering] = useState<"drop" | "retry" | null>(null);
  /** The gate is waiting for a slot on the line. */
  const [forSlot, setForSlot] = useState(false);
  const played = useRef(false);
  const playingSince = useRef<number | null>(null);
  const tries = useRef(0);
  const tryGen = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    // Set here, not only at creation: StrictMode's dev replay runs the
    // cleanup below and then this again, and a flag only ever cleared left
    // every tile in `pnpm tauri dev` thinking it was gone.
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const reconnect = async (why: "drop" | "retry") => {
    const gen = ++tryGen.current;
    setFailure(null);
    setRecovering(why);
    await gateRef
      .current((on) => {
        if (alive.current && gen === tryGen.current) setForSlot(on);
      })
      .catch(() => {});
    if (!alive.current || gen !== tryGen.current) return;
    setForSlot(false);
    setAttempt((n) => n + 1);
  };
  /** The stream is gone: connect again while the budget lasts, else say why. */
  const lose = (f: Failure) => {
    const s = spend(tries.current, playingSince.current, performance.now());
    playingSince.current = null;
    if (!mayReconnect(f, played.current) || !s.give) {
      setRecovering(null);
      setFailure(f);
      return;
    }
    tries.current = s.tries;
    void reconnect("drop");
  };
  const loseRef = useRef(lose);
  loseRef.current = lose;
  /** Retry, by hand: a full budget, through the same gate. */
  const retry = () => {
    tries.current = 0;
    playingSince.current = null;
    void reconnect("retry");
  };
  // A fresh look-up that found nothing is its own state ("No stream"), with
  // its own Retry: this one is over.
  useEffect(() => {
    if (!url && unresolved) setRecovering(null);
  }, [url, unresolved]);
  // The buffering profile (multiviewTuning.ts). A change re-creates the
  // player, so btvMultiviewTune can A/B it on streams that are playing.
  const [profile, setProfile] = useState(getMvProfile);
  useEffect(() => onMvProfileChange(setProfile), []);
  // Read when a failure lands, not when the effect started: the line fills
  // and empties while a tile is tuning.
  const atCapRef = useRef(atCap);
  atCapRef.current = atCap;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    let disposed = false;
    setFailure(null);
    setPlaying(false);
    setStalled(false);
    setStalledS(0);

    // Both libraries are loaded on demand rather than at module scope: a
    // viewer who never opens multi-view should not pay for a demuxer, and
    // the .m3u8 path should not drag in the TS one or the reverse.
    let destroy: (() => void) | undefined;
    // What the tile learned on the way, for the words if it fails.
    const facts: FailureFacts = {};
    // What the stream turned out to carry, once a library has looked. Read
    // by logFailure, so a codec refusal names the codec.
    let codecs = "";
    let failed = false;
    const fail = (why: string) => {
      if (disposed || failed) return;
      failed = true;
      logFailure(name, why, codecs);
      facts.codecs = codecs || undefined;
      facts.atCap = atCapRef.current;
      // Let go of it at once, outside the library's own event: a failed
      // player kept loading into a MediaSource that refused every segment,
      // holding its connection and growing by the stream's bitrate until
      // the webview died (plan 018, R1).
      window.setTimeout(() => {
        if (disposed) return;
        destroy?.();
        destroy = undefined;
      }, 0);
      loseRef.current(explainFailure(name, facts));
    };
    // The codecs, checked against what Media Source can play the moment the
    // demuxer names them, rather than waiting for a decoder to give up.
    const checkCodecs = (videoCodec?: string, audioCodec?: string) => {
      codecs = [videoCodec, audioCodec].filter(Boolean).join(" + ");
      const bad = unplayable(videoCodec, audioCodec, (m) => MediaSource.isTypeSupported(m));
      facts.playable = bad === null;
      if (bad !== null) {
        fail(`this browser cannot play ${bad}`);
        destroy?.();
        destroy = undefined;
      }
    };

    // The first frame, stalls after it, and the time they cost.
    let waitingSince = 0;
    let stallTimer = 0;
    const onPlaying = () => {
      played.current = true;
      playingSince.current ??= performance.now();
      setRecovering(null);
      window.clearTimeout(stallTimer);
      if (waitingSince) {
        const lost = (performance.now() - waitingSince) / 1000;
        setStalledS((s) => s + lost);
        waitingSince = 0;
      }
      setPlaying(true);
      setStalled(false);
    };
    const onWaiting = () => {
      if (!waitingSince) waitingSince = performance.now();
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => setStalled(true), STALL_MS);
    };
    // The element's own verdict. MSE rejecting what it was fed lands here
    // as well as (sometimes instead of) in the library's error event.
    const onVideoError = () => {
      const err = video.error;
      if (!err || disposed) return;
      facts.media = true;
      fail(`video element: code ${err.code} ${err.message}`);
    };
    // A live stream has no end: one that ends has dropped. Through the proxy
    // an end is an error now (plan 018, R2); played straight, the loader
    // completes, mpegts.js ends the MediaSource, and once what was buffered
    // has played, this.
    const onEnded = () => {
      facts.cut = true;
      fail("the video ended");
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("error", onVideoError);
    video.addEventListener("ended", onEnded);
    // The freeze watch (mvRecover.watchStep): decoded frames, every two
    // seconds, while the tile can be seen.
    let watch = newWatch(performance.now());
    const watcher = window.setInterval(() => {
      if (disposed || failed) return;
      const frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      const looking = document.visibilityState === "visible" && !video.paused;
      const step = watchStep(watch, frames, performance.now(), looking);
      watch = step.w;
      if (step.frozen) {
        facts.frozen = true;
        fail(`no new picture for ${FROZEN_MS / 1000}s`);
      }
    }, 2000);
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
          const hls = new Hls(hlsConfig());
          hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
            const l = data.levels[0];
            if (l) checkCodecs(l.videoCodec, l.audioCodec);
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.response?.code) facts.code = data.response.code;
            if (data.response?.text) facts.statusText = data.response.text;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !data.response?.code)
              facts.network = true;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) facts.media = true;
            fail(
              `hls.js ${data.type} / ${data.details}` +
                (data.response ? ` / HTTP ${data.response.code}` : "") +
                (data.error ? ` / ${data.error.message}` : ""),
            );
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
          facts.playable = false;
          fail("mpegts.js isSupported() is false: MSE has no H.264 here");
          return;
        }
        // A native build from before the proxy has no such command; the
        // tile then tries the stream directly, as it always did.
        let proxied = "";
        if (isTauri()) {
          // Asked for HEVC conversion only when this webview can't play
          // it: with Windows' HEVC extension installed it plays as it is.
          const convertHevc = !MediaSource.isTypeSupported(HEVC_MIME);
          proxied = await tauriMvProxyOpen(url, convertHevc).catch(() => "");
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
          checkCodecs(info.videoCodec, info.audioCodec);
        });
        player.on(
          mpegts.Events.ERROR,
          (type: string, detail: string, info?: { code?: number; msg?: string }) => {
            if (detail === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID) {
              facts.code = info?.code;
              facts.statusText = info?.msg;
            } else if (detail === mpegts.ErrorDetails.NETWORK_UNRECOVERABLE_EARLY_EOF) {
              facts.cut = true;
            } else if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
              facts.network = true;
            } else if (type === mpegts.ErrorTypes.MEDIA_ERROR) {
              facts.media = true;
            }
            fail(
              `mpegts.js ${type} / ${detail}` +
                (info?.code != null && info.code !== -1 ? ` / code ${info.code}` : "") +
                (info?.msg ? ` / ${info.msg}` : ""),
            );
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
        fail(`setup threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(stallTimer);
      window.clearInterval(watcher);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("ended", onEnded);
      // Destroy before the element goes: a demuxer still appending to a
      // detached media source is how a closed tile keeps its connection.
      destroy?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, name, profile, attempt]);

  // Audio follows focus rather than being set at mount, so moving focus does
  // not restart a stream. Exactly one tile is ever unmuted; the grid owns
  // that invariant and this just obeys it. The bar's volume and mute are
  // the sound tile's (plan 017, "Sound and volume").
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !focused || muted;
    video.volume = volume;
  }, [focused, muted, volume]);

  // The Sound badge's bars follow what the feed is actually saying, on the
  // sound tile only (mvLevel.ts). Set on the element directly: sixty
  // renders a second of this tile to move three bars would be absurd.
  const barsRef = useRef<HTMLSpanElement>(null);
  const level = useRef<LevelWatch | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !focused || !playing) return;
    const watch = watchLevel(video, ([low, mid, high]) => {
      const el = barsRef.current;
      if (!el) return;
      el.style.setProperty("--b1", low.toFixed(3));
      el.style.setProperty("--b2", mid.toFixed(3));
      el.style.setProperty("--b3", high.toFixed(3));
    });
    level.current = watch;
    return () => {
      level.current = null;
      watch.stop();
    };
  }, [focused, playing]);

  // The Sound badge shows when the sound arrives here, then fades back to
  // the hairline ring. YouTube TV made theirs fade because an always-on
  // marker was called distracting; Channels DVR fades by default.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focused) {
      setFlash(false);
      return;
    }
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [focused]);

  // The bars are measured only while the badge can be seen (plan 018, P1):
  // the flash, or the pointer over the tile with the tab awake, as
  // player.css shows it, and never muted, where they sit flat. Measuring
  // behind a hidden badge cost 64.8ms of main thread a second, the thread
  // that transmuxes every tile.
  const [hovered, setHovered] = useState(false);
  const barsSeen = focused && playing && !muted && !picking && (flash || (hovered && !idle));
  useEffect(() => {
    level.current?.run(barsSeen);
  }, [barsSeen, focused, playing]);

  const [clock] = useState(loadClockFormat);
  const on = airing(programmes, now).now;
  const behind = behindLabel(stalledS);
  const chanLine = [channel.name, channel.number].filter((v) => v != null).join(" · ");

  let state: ReactNode = null;
  if (!url && unresolved) {
    state = (
      <div className="mvtile__state mvtile__state--fail" data-kind="unresolved">
        <span className="mvtile__stateicon" aria-hidden>
          <WarnIcon size={22} />
        </span>
        <b className="mvtile__statetitle">No stream for {name}</b>
        <span className="mvtile__statesub">Your provider didn’t give one for this channel.</span>
        <button type="button" className="mvchip" onClick={own(onRetryResolve)}>
          Retry
        </button>
      </div>
    );
  } else if (failure) {
    state = (
      <div className="mvtile__state mvtile__state--fail" data-kind={failure.kind}>
        <span className="mvtile__stateicon" aria-hidden>
          <WarnIcon size={22} />
        </span>
        <b className="mvtile__statetitle">{failure.title}</b>
        <span className="mvtile__statesub">{failure.reason}</span>
        {failure.retry && (
          <button type="button" className="mvchip" onClick={own(retry)}>
            Retry
          </button>
        )}
      </div>
    );
  } else if (recovering) {
    state = (
      <div className="mvtile__state" data-kind="reconnecting">
        <span className="buffering__dot" aria-hidden />
        <b className="mvtile__statetitle">Reconnecting {name}</b>
        <span className="mvtile__statesub">
          {forSlot
            ? "Waiting for a free slot on your line."
            : recovering === "drop"
              ? "It dropped. Getting it back."
              : "Trying again."}
        </span>
      </div>
    );
  } else if (!playing) {
    state = (
      <div className="mvtile__state">
        {/* The main player's buffering pulse, so the two speak one language. */}
        <span className="buffering__dot" aria-hidden />
        <b className="mvtile__statetitle">Tuning {name}</b>
        {chanLine !== name && <span className="mvtile__statesub">{chanLine}</span>}
      </div>
    );
  } else if (stalled) {
    state = (
      <div className="mvtile__stall">
        <span className="mvtile__buffering">
          <span className="buffering__dot" aria-hidden />
          Buffering
        </span>
      </div>
    );
  }

  // A failed tile has nothing to hear, so it cannot take the sound: a click
  // on it, or on where Sound here would be, would leave the grid silent.
  const dead = !!failure || (!url && !!unresolved);
  const takeSound = dead ? () => {} : onFocus;
  const act = picking && onPick ? onPick : takeSound;
  const onDeadRef = useRef(onDead);
  onDeadRef.current = onDead;
  useEffect(() => onDeadRef.current?.(dead), [dead]);

  const label =
    `${name}, ${focused && !muted ? "sound on" : "muted"}` +
    (!url && unresolved
      ? ", no stream"
      : failure
        ? `, ${failure.title}`
        : recovering
          ? ", reconnecting"
          : !playing
            ? ", tuning"
            : game
              ? `, ${scoreLine(game)}`
              : on
                ? `, ${on.title}`
                : "");

  return (
    <div
      ref={rootRef}
      className={
        "mvtile" +
        (focused ? " is-on" : "") +
        (flash ? " is-flash" : "") +
        (dead ? " is-failed" : "") +
        (picking ? " is-picking" : "")
      }
      style={style}
      data-mv={mvId}
      role="group"
      tabIndex={0}
      aria-label={picking ? `${label}. Swap for ${picking}` : label}
      data-state={
        dead ? "failed" : recovering ? "reconnecting" : !playing ? "tuning" : stalled ? "stalled" : "playing"
      }
      onClick={act}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        // Space takes the sound. Enter is left to the grid, which fills the
        // window with this tile (plan 017's table) and gives it the sound.
        // While a tile is being picked, both pick this one.
        if (e.target !== e.currentTarget) return;
        if (e.key === " " || (picking && e.key === "Enter")) {
          e.preventDefault();
          act();
        }
      }}
    >
      <video ref={videoRef} className="mvtile__video" playsInline autoPlay muted />
      {state}
      {focused && (
        <span className={"mvtile__badge" + (muted ? " is-muted" : "")} aria-hidden>
          <span className="mvbars" ref={barsRef}>
            <i />
            <i />
            <i />
          </span>
          {muted ? "Muted" : "Sound"}
        </span>
      )}
      <div className="mvtile__chrome">
        <div className="mvtile__actions">
          {!focused && !dead && (
            <button type="button" className="mvchip" onClick={own(onFocus)}>
              <VolumeIcon size={15} />
              Sound here
            </button>
          )}
          {/* The app's tooltips, not the browser's (ui/Hint). The keys are
            * named on the sound tile only: R and Delete act on it. */}
          <Hint label="Watch in player">
            <button
              type="button"
              className="mvchip mvchip--icon"
              aria-label={`Watch ${name} in the player`}
              onClick={own(onWatch)}
            >
              <PlayIcon size={15} />
            </button>
          </Hint>
          <Hint label={focused ? "Replace (R)" : "Replace"}>
            <button
              type="button"
              className="mvchip mvchip--icon"
              aria-label={`Replace ${name}`}
              onClick={own(onReplace)}
            >
              <SwapIcon size={15} />
            </button>
          </Hint>
          <Hint label={focused ? "Close (Delete)" : "Close"}>
            <button
              type="button"
              className="mvchip mvchip--icon"
              aria-label={`Close ${name}`}
              onClick={own(onRemove)}
            >
              <CloseIcon size={15} />
            </button>
          </Hint>
        </div>
        {playing && !failure && !recovering && (
          <div className="mvtile__info">
            <MvLogo channel={channel} size={40} />
            <div className="mvtile__meta">
              <div className="mvtile__chan">{chanLine}</div>
              <div className="mvtile__title">
                {game ? scoreLine(game) : (on?.title ?? name)}
              </div>
              {game ? (
                <div className="mvtile__prog">
                  <span className="mvtile__gamestatus">
                    {[
                      game.status,
                      game.league,
                      scoreAt !== undefined && now.getTime() - scoreAt > SCORE_STALE_MS
                        ? `as of ${formatClock(new Date(scoreAt), clock)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ) : on && (
                <div className="mvtile__prog">
                  <span>{formatClock(on.start, clock)}</span>
                  <span className="mvtile__track">
                    <i style={{ width: `${progress(on.start, on.end, now) * 100}%` }} />
                  </span>
                  <span>{formatClock(on.end, clock)}</span>
                </div>
              )}
            </div>
            <span className={"mvtile__live" + (behind ? " is-behind" : "")}>{behind ?? "LIVE"}</span>
          </div>
        )}
      </div>
      {picking && (
        <div className="mvtile__pick" aria-hidden>
          <span className="mvchip mvtile__pickword">Swap for {picking}</span>
        </div>
      )}
    </div>
  );
}
