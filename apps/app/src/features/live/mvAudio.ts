/**
 * Multi-view's sound, out of the webview and into the app's own process, so a
 * Discord window share with sound carries it.
 *
 * WHY. Stream, Live TV and Sports play through libmpv inside BlammyTV.exe, and
 * Discord's per-app capture hears that process. A multi-view tile is a
 * `<video>` in the webview, and WebView2 renders its audio in its own process
 * (msedgewebview2.exe), which that capture misses: viewers heard nothing while
 * Adam heard it locally. Microsoft tracks it with no fix
 * (MicrosoftEdge/WebView2Feedback#2236), so the sound goes out as samples and
 * mvaudio.rs plays it.
 *
 * THE PATH. The sound tile's `captureStream()` copy, into a GainNode (the
 * bar's volume on mpv's curve, or 0 when muted), into an AudioWorkletNode
 * that is NOT connected to the destination, so the webview outputs nothing.
 * The worklet hands each quantum over a MessageChannel to a Worker, which
 * batches about 20ms and POSTs it to the native listener. The page's thread
 * is not in that path, so a long render cannot starve it.
 *
 * MEASURED, headless Chromium 141 (WebView2's engine), before this was built:
 * - a `<video>` that is muted, or at volume 0, still hands the full signal to
 *   captureStream() (RMS 0.088 in all three cases), so the tile can be
 *   silent in the webview while a copy of its sound is taken. mvLevel.ts
 *   already taps the sound tile this way for the level bars; its header says
 *   why a copy and not createMediaElementSource;
 * - a worklet node with its output unconnected is still processed: 348
 *   quanta in a second, every one with the real signal.
 *
 * ITS OWN AudioContext, at the output's own rate, so neither side resamples.
 * Not mvLevel's, which suspends itself whenever nothing is measuring.
 *
 * THE FALLBACK IS TODAY'S BEHAVIOUR EXACTLY: the sound tile's `<video>`
 * unmuted at the bar's volume. It holds outside the Tauri shell, when
 * `mv_audio_open` fails (a hot bundle on a native build from before it has no
 * such command), while the context cannot run yet (it needs a click or a key,
 * and starts on the next one), and whenever the pipe breaks (the worker says
 * so). Never both at once, so no doubled sound, and never neither, so no
 * silent grid beyond the moment it takes to prove the pipe carries sound: the
 * tiles are muted only once the native side has taken the first batch AND
 * the copy has carried sound (`heard`). Until then the copy goes out at gain
 * 0 and the tile plays itself.
 *
 * WHY THE COPY MUST BE HEARD FIRST (v0.11.45). From v0.11.12 to v0.11.44 the
 * tiles were muted on the first batch alone. On Adam's WebView2 (Edge 154)
 * the copy is pure zeros: the tile playing and decoding audio, the copy
 * attached with a live track, gain 1, the context running, and every sample
 * 0, with the tile muted, unmuted at volume 0 and unmuted at 0.001 alike
 * (v0.11.44's probe). So multi-view was silent for him from v0.11.12 on,
 * while headless Chromium 141 copies full sound in every one of those cases.
 * Where the copy is silent, the sound now stays the tile's, and the log says
 * so once a copy.
 *
 * A DEAD COPY IS TAKEN AGAIN (v0.11.48). What the silence was: on Adam's
 * machine the copy taken as the tile starts delivers 0 frames for good,
 * while copies of the same tile taken seconds later carry its full sound
 * (-10.3 dBFS frame by frame, -14.4 through Web Audio), and the tile's
 * picture draws and copies normally, so it plays inside Chromium. Why the
 * first copy dies is not known; mpegts.js seeks the tile right after it
 * starts, and the log's events now say when. So a copy that stays quiet
 * while the tile's media plays on is taken again (after 1.5s, then 3, 6,
 * 12), and a heard copy that goes quiet the same way is replaced too, the
 * tile playing itself until the new one is heard.
 *
 * ONE ROUTING at a time, started when the grid has a sound tile and stopped
 * when it empties or the tab unmounts (leaving for Watch in player or the
 * popout goes through the unmount). Native calls go one after another, so a
 * close from the tab going can never land after the open of the one coming
 * back and take its output down.
 */
import { useEffect } from "react";
import {
  isTauri,
  tauriMvAudioClose,
  tauriMvAudioOpen,
  tauriMvAudioStats,
  type MvAudioSink,
} from "../../lib/tauri";
import { scrubbedMessage } from "../../lib/errors";
import { tileGain } from "./multiviewTuning";
import type { FromSender, ToSender } from "./mvAudio.worker";
import type { TapInit } from "./mvAudio.worklet";
import { probeCopy } from "./mvAudioProbe";

/* ------------------------------------------------------------ the rules */

/** What decides where the sound plays. */
export interface RouteInputs {
  /** In the shell, not a plain browser. */
  tauri: boolean;
  /** The native output opened and has taken sound from the page. */
  sink: boolean;
  /** The audio context is running (it can wait on a click). */
  running: boolean;
  /** The grid's sound tile, if it has one. */
  soundId: string | null;
  muted: boolean;
  /** The bar's slider, 0 to 1. */
  volume: number;
}

/** Whether the sound goes through the app. Every input has to say yes. */
export const isRouted = (i: RouteInputs): boolean =>
  i.tauri && i.sink && i.running && i.soundId !== null;

/** The routed copy's gain: mpv's cubic curve on the slider, 0 when muted. */
export const gainFor = (i: Pick<RouteInputs, "muted" | "volume">): number =>
  i.muted ? 0 : tileGain(i.volume);

/** What a tile's `<video>` is set to. */
export interface ElementAudio {
  muted: boolean;
  volume: number;
}

/**
 * What a tile's element gets. Routed, every one is muted: the webview plays
 * nothing. The volume sits at 1, so the element can never turn the copy down
 * a second time: the gain applies the bar's volume, once. Not routed, today's
 * behaviour: only the sound tile is unmuted, unless the bar is muted, at the
 * bar's volume on mpv's curve.
 */
export function elementFor(
  routed: boolean,
  isSound: boolean,
  muted: boolean,
  volume: number,
): ElementAudio {
  if (routed) return { muted: true, volume: 1 };
  return { muted: !isSound || muted, volume: tileGain(volume) };
}

/* ------------------------------------------------------------- the state */

/** What the grid last said: the sound tile and the bar. Silent until it
 * says, so a tile that binds first never plays at a made-up volume. */
let want = { soundId: null as string | null, volume: 0, muted: true };
/** The sound tile's element, handed over by the tile (`routeSound`). */
let soundVideo: HTMLVideoElement | null = null;
/** Every tile's element, and whether it is the sound tile. */
const tiles = new Map<HTMLVideoElement, boolean>();
let current: Routing | null = null;
let routedNow = false;

/** Set every tile's element to what `elementFor` says. */
function apply(): void {
  for (const [video, isSound] of tiles) {
    const a = elementFor(routedNow, isSound, want.muted, want.volume);
    video.muted = a.muted;
    video.volume = a.volume;
  }
}

function publish(): void {
  const next =
    current !== null &&
    isRouted({ tauri: true, sink: current.carrying(), running: current.running(), ...want });
  if (next === routedNow) return;
  routedNow = next;
  apply();
}

/** Native calls, one at a time and in the order they were asked. */
let native: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = native.then(fn);
  native = next.catch(() => {});
  return next;
}

/** How fast the gain follows the bar: a time constant, so a mute or a slider
 * step does not click, and a jump to 0 is silent within a tenth of a second. */
const GAIN_TC = 0.01;

/** How long a copy may go unheard before the log says the sound stays the
 * tile's. */
const CHECK_MS = 5000;

/** How often the copy is listened to. */
const LISTEN_MS = 100;

/** A copy that carries nothing while this much of the tile's media plays is
 * taken again. The first wait; each retry while unheard doubles it, to
 * RECOPY_MAX_S. v0.11.47 on Adam's WebView2: the routing's first copy, taken
 * as the tile starts, delivered 0 frames for good, while copies taken from
 * the same tile seconds later read -10.3 and -14.4 dBFS. */
const RECOPY_S = 1.5;
const RECOPY_MAX_S = 12;

/** Below this, a heard copy is quiet: -80 dBFS. Quiet for RECOPY_S of
 * played media, it has died (it did once a tile seeked, the likeliest
 * reading of the dead first copy), and a new one is taken. A feed's own
 * digital silence can trip it too; that costs a new copy, and the sound
 * stays the tile's until the new copy is heard. */
const QUIET = 1e-4;

/** Louder than this, before the gain, is sound: -40 dBFS. A feed's speech
 * and music peak well above it within seconds. The copy that fails is not
 * always exact zeros: on Adam's WebView2 (v0.11.46) fresh copies of a tile
 * he heard at a normal level read -55.8 and -88.6 dBFS, and a floor below
 * those would hand the sound to a copy that carries none. */
const HEARD = 0.01;

/** Chromium's count of the audio bytes an element has decoded. Not standard,
 * so possibly missing. */
const decodedAudio = (v: HTMLVideoElement): number | undefined =>
  (v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;

class Routing {
  private dead = false;
  /** Gave up (opening or on the way): the sound is the webview's. */
  private failed = false;
  /** The native side has taken a batch from the pipe. */
  private flowing = false;
  private opened = false;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private undo: (() => void) | null = null;
  /** The current copy's own listeners. */
  private copyOff: AbortController | null = null;
  /** The current copy has carried sound. Each new copy starts unheard. */
  private heard = false;
  /** Listens to the copy before the gain: whether it is heard, and whether
   * it has died since. */
  private ear: AnalyserNode | null = null;
  /** mvAudioProbe has run: once a routing, it is a question, not a watch. */
  private probed = false;

  carrying = () => this.flowing && this.heard && !this.failed && !this.dead;
  running = () => this.ctx?.state === "running";

  async open(): Promise<void> {
    this.opened = true;
    let sink: MvAudioSink | undefined;
    try {
      sink = await serial(() => tauriMvAudioOpen());
    } catch (e) {
      return this.giveUp(`no sound output (${scrubbedMessage(e)})`);
    }
    if (this.dead) return;
    if (!sink || typeof sink.url !== "string" || !(sink.rate > 0)) {
      return this.giveUp("the native side gave no sound output");
    }
    try {
      const ctx = new AudioContext({ sampleRate: sink.rate });
      this.ctx = ctx;
      ctx.addEventListener("statechange", this.onState);
      // A real bundled file, never a blob: the CSP is `script-src 'self'`.
      // Loaded here and not at the top, so nothing that only needs the rules
      // above (the tests) pulls a worker build in.
      const { default: tapUrl } = await import("./mvAudio.worklet.ts?worker&url");
      await ctx.audioWorklet.addModule(tapUrl);
      if (this.dead) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const node = new AudioWorkletNode(ctx, "mv-audio-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        // Web Audio downmixes 5.1 and upmixes mono to this for us.
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      gain.connect(node);
      this.gain = gain;
      this.node = node;
      const worker = new Worker(new URL("./mvAudio.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<FromSender>) => {
        if ("ready" in e.data) {
          this.flowing = true;
          publish();
        } else {
          this.giveUp(e.data.failed);
        }
      };
      worker.onerror = (e) => this.giveUp(e.message || "the sound worker failed to load");
      const { port1, port2 } = new MessageChannel();
      const init: ToSender = { init: { port: port1, url: sink.url, rate: sink.rate } };
      worker.postMessage(init, [port1]);
      node.port.postMessage({ out: port2 } satisfies TapInit, [port2]);
      this.onState();
      // A context made before any click can't start until the page has had
      // one; the next click or key tries again, as mvLevel's does.
      window.addEventListener("pointerdown", this.wake);
      window.addEventListener("keydown", this.wake);
      void ctx.resume().catch(() => {});
      this.rewire();
    } catch (e) {
      this.giveUp(`could not set the sound up (${scrubbedMessage(e)})`);
    }
  }

  private wake = () => {
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
  };

  private onState = () => {
    this.worker?.postMessage({ run: this.running() } satisfies ToSender);
    publish();
  };

  /** Point the pipe at the sound tile's element, or at nothing. */
  rewire(): void {
    this.unplug();
    this.heard = false;
    this.level();
    publish();
    const video = soundVideo;
    const { ctx, gain } = this;
    if (!video || !ctx || !gain || this.dead || this.failed) return;
    if (typeof (video as { captureStream?: unknown }).captureStream !== "function") {
      return this.giveUp("no captureStream on a tile");
    }
    // What happened to the tile and its copies, for the log lines.
    const events: string[] = [];
    const from = performance.now();
    const note = (what: string) => {
      if (events.length < 40) events.push(`${what} at ${((performance.now() - from) / 1000).toFixed(1)}s`);
    };
    const off = new AbortController();
    for (const e of ["seeking", "seeked", "waiting", "emptied", "loadedmetadata"]) {
      video.addEventListener(e, () => note(`tile ${e}`), { signal: off.signal });
    }
    let copies = 0;
    if (!this.take(video, note)) return;
    copies = 1;
    const decoded = decodedAudio(video);
    // Only time the context runs counts: one waiting on a first click hears
    // nothing, and that is not the copy's fault. Quiet is measured in the
    // tile's own media time, so a stalled tile is never blamed on its copy.
    let unheardMs = 0;
    let said = false;
    let died = 0;
    let wait = RECOPY_S;
    let quietFrom = video.currentTime;
    const buf = new Float32Array(2048);
    const watch = window.setInterval(() => {
      if (this.ctx?.state !== "running") return;
      let peak = 0;
      const ear = this.ear;
      if (ear) {
        ear.getFloatTimeDomainData(buf);
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
      }
      if (!this.heard && peak > HEARD) {
        this.heard = true;
        note(`copy ${copies} heard`);
        this.level();
        publish();
      }
      if (!this.heard) {
        unheardMs += LISTEN_MS;
        if (!said && unheardMs >= CHECK_MS) {
          said = true;
          this.unheard(video, decoded, events, copies);
        }
      }
      if (peak > (this.heard ? QUIET : HEARD) || video.currentTime < quietFrom) {
        quietFrom = video.currentTime;
        if (this.heard) wait = RECOPY_S;
        return;
      }
      if (video.paused || video.currentTime - quietFrom < wait) return;
      // Quiet while the tile played on: take the copy again.
      if (this.heard) {
        if (died++ < 3) {
          console.warn(
            `[mv] sound: copy ${copies} went silent for ${wait}s while the tile played on; ` +
              `taking a new one, the tile plays itself until it is heard. ` +
              `Events: ${events.join(", ") || "none"}.`,
          );
        }
        this.heard = false;
        this.level();
        publish();
      } else {
        wait = Math.min(wait * 2, RECOPY_MAX_S);
      }
      this.dropCopy();
      if (!this.take(video, note)) return;
      copies++;
      quietFrom = video.currentTime;
    }, LISTEN_MS);
    this.undo = () => {
      off.abort();
      window.clearInterval(watch);
    };
  }

  /** Take a copy of the tile's sound and plug it in, before the gain and the
   * ear. False when it can't be taken (the routing has given up then). */
  private take(video: HTMLVideoElement, note: (what: string) => void): boolean {
    const { ctx, gain } = this;
    if (!ctx || !gain) return false;
    let stream: MediaStream;
    try {
      stream = (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream();
    } catch (e) {
      this.giveUp(`could not copy a tile's sound (${scrubbedMessage(e)})`);
      return false;
    }
    const off = new AbortController();
    const watchTrack = (t: MediaStreamTrack) => {
      for (const e of ["mute", "unmute", "ended"]) {
        t.addEventListener(e, () => note(`track ${e}`), { signal: off.signal });
      }
    };
    // The copy's video is stopped at once: only the sound is wanted.
    // Tracks arrive when the stream's media does, and again after a retry.
    const attach = () => {
      for (const t of stream.getVideoTracks()) t.stop();
      if (this.source || stream.getAudioTracks().length === 0) return;
      this.source = ctx.createMediaStreamSource(stream);
      this.source.connect(gain);
      const ear = ctx.createAnalyser();
      ear.fftSize = 2048;
      this.source.connect(ear);
      this.ear = ear;
      note("attached");
    };
    attach();
    stream.getAudioTracks().forEach(watchTrack);
    stream.addEventListener(
      "addtrack",
      (e) => {
        if (e.track.kind === "audio") {
          note("audio track added");
          watchTrack(e.track);
        }
        attach();
      },
      { signal: off.signal },
    );
    stream.addEventListener(
      "removetrack",
      (e) => e.track.kind === "audio" && note("audio track removed"),
      { signal: off.signal },
    );
    this.stream = stream;
    this.copyOff = off;
    return true;
  }

  /**
   * Five seconds of a running context and no copy heard: the sound has stayed
   * the tile's, and one console.warn says what the tile and the copy looked
   * like. It reaches the log (lib/appLog.ts), so Settings → App → Copy
   * Diagnostics carries it. Listening and retaking go on: a copy heard later
   * still takes the sound over. The first time in a routing, mvAudioProbe
   * asks why, in a line of its own.
   */
  private unheard(
    video: HTMLVideoElement,
    decoded: number | undefined,
    events: string[],
    copies: number,
  ): void {
    const stream = this.stream;
    if (!stream) return;
    const now = decodedAudio(video);
    const tracks = stream
      .getAudioTracks()
      .map((t) => `${t.readyState}${t.muted ? " muted" : ""}${t.enabled ? "" : " disabled"}`);
    console.warn(
      `[mv] sound stays in the webview: the copy of the tile's sound was silent for ${CHECK_MS / 1000}s ` +
        `(${copies} ${copies === 1 ? "copy" : "copies"}). ` +
        `Tile: ${video.isConnected ? "" : "detached, "}${video.paused ? "paused" : "playing"}, ` +
        `audio decoded ` +
        `${now === undefined || decoded === undefined ? "?" : `${now - decoded} bytes`} in that time. ` +
        `Copy: ${this.source ? "attached" : "never attached"}, audio tracks [${tracks.join(", ")}], ` +
        `context ${this.ctx?.state} at ${this.ctx?.sampleRate} Hz. ` +
        `Events: ${events.join(", ") || "none"}.`,
    );
    const ctx = this.ctx;
    if (this.probed || !ctx) return;
    this.probed = true;
    void probeCopy(video, stream, ctx).then((line) => {
      if (!this.dead) console.warn(line);
    });
  }

  /** Let go of the copy: its listeners, its nodes, its tracks. */
  private dropCopy(): void {
    this.copyOff?.abort();
    this.copyOff = null;
    this.source?.disconnect();
    this.source = null;
    this.ear = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }

  private unplug(): void {
    this.undo?.();
    this.undo = null;
    this.dropCopy();
  }

  /** The bar moved, or the copy was heard: ease the gain there. Nothing
   * goes out until the copy is heard, while the tile plays itself. */
  level(): void {
    if (this.gain && this.ctx) {
      const to = this.heard ? gainFor(want) : 0;
      this.gain.gain.setTargetAtTime(to, this.ctx.currentTime, GAIN_TC);
    }
  }

  /** Not going to work (or has stopped): the webview plays the sound. */
  private giveUp(why: string): void {
    if (this.dead || this.failed) return;
    this.failed = true;
    console.warn(`[mv] sound stays in the webview: ${scrubbedMessage(why)}`);
    this.teardown();
    publish();
  }

  private teardown(): void {
    window.removeEventListener("pointerdown", this.wake);
    window.removeEventListener("keydown", this.wake);
    this.unplug();
    this.worker?.terminate();
    this.worker = null;
    this.gain?.disconnect();
    this.node?.disconnect();
    this.gain = this.node = null;
    this.ctx?.removeEventListener("statechange", this.onState);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.flowing = false;
  }

  stop(): void {
    if (this.dead) return;
    this.dead = true;
    this.teardown();
    // What the output did, as one console line, then free the device.
    if (this.opened) {
      void serial(async () => {
        try {
          const s = await tauriMvAudioStats();
          if (s?.open) {
            console.info(
              `[mv] sound output: ${s.chunks} batches, ${s.underruns} underruns, ` +
                `${s.overruns} overruns (${s.droppedMs}ms dropped), ${s.bufferedMs}ms buffered`,
            );
          }
        } catch {
          // An older native build, or already closed.
        }
        await tauriMvAudioClose().catch(() => {});
      });
    }
  }
}

/**
 * Start routing the sound through the app, and return what stops it. In a
 * plain browser, or on a webview that cannot copy an element's sound, nothing
 * starts and the tiles play their own sound.
 */
export function startMvAudio(): () => void {
  if (
    !isTauri() ||
    typeof AudioContext === "undefined" ||
    typeof HTMLMediaElement === "undefined" ||
    typeof (HTMLMediaElement.prototype as { captureStream?: unknown }).captureStream !== "function"
  ) {
    return () => {};
  }
  const r = new Routing();
  current = r;
  // Not in this tick: an effect that is started and stopped at once (React's
  // StrictMode in dev, a tab entered and left) opens nothing and closes
  // nothing, instead of an open and a close for the native side to chew on.
  const later = window.setTimeout(() => void r.open(), 0);
  return () => {
    window.clearTimeout(later);
    r.stop();
    if (current === r) current = null;
    publish();
  };
}

/**
 * A tile hands over its element and whether it is the sound tile, and from
 * then on this decides whether the element is muted and at what volume
 * (`elementFor`): the bar's, on the sound tile, today; muted on every tile
 * while the app plays the sound. The returned function lets go.
 */
export function bindTile(video: HTMLVideoElement, isSound: boolean): () => void {
  tiles.set(video, isSound);
  apply();
  return () => {
    tiles.delete(video);
  };
}

/**
 * The sound tile hands over its element while it is the sound tile and
 * playing, and the routing copies its sound. A new element (the sound moved,
 * or the stream came back after a retry) is a new copy. The returned
 * function lets go.
 */
export function routeSound(video: HTMLVideoElement): () => void {
  soundVideo = video;
  current?.rewire();
  return () => {
    if (soundVideo !== video) return;
    soundVideo = null;
    current?.rewire();
  };
}

/** The grid's sound tile and the bar's volume and mute. */
export function setLevel(soundId: string | null, volume: number, muted: boolean): void {
  want = { soundId, volume, muted };
  current?.level();
  publish();
  apply();
}

/**
 * For the grid: route while it has a sound tile, and follow the bar. Which
 * tile is the sound tile is the grid's own call (it falls to the first live
 * one), so the id comes from there.
 */
export function useMvAudio(soundId: string | null, volume: number, muted: boolean): void {
  const active = soundId !== null;
  useEffect(() => {
    if (!active) return;
    return startMvAudio();
  }, [active]);
  useEffect(() => setLevel(soundId, volume, muted), [soundId, volume, muted]);
}
