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
 * tiles are muted only once the native side has taken the first batch.
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

  carrying = () => this.flowing && !this.failed && !this.dead;
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
      gain.gain.value = gainFor(want);
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
    const video = soundVideo;
    const { ctx, gain } = this;
    if (!video || !ctx || !gain || this.dead || this.failed) return;
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream })
      .captureStream;
    if (typeof capture !== "function") return this.giveUp("no captureStream on a tile");
    let stream: MediaStream;
    try {
      stream = capture.call(video);
    } catch (e) {
      return this.giveUp(`could not copy a tile's sound (${scrubbedMessage(e)})`);
    }
    // The copy's video is stopped at once: only the sound is wanted.
    // Tracks arrive when the stream's media does, and again after a retry.
    const attach = () => {
      for (const t of stream.getVideoTracks()) t.stop();
      if (this.source || stream.getAudioTracks().length === 0) return;
      this.source = ctx.createMediaStreamSource(stream);
      this.source.connect(gain);
    };
    attach();
    stream.addEventListener("addtrack", attach);
    this.stream = stream;
    this.undo = () => stream.removeEventListener("addtrack", attach);
  }

  private unplug(): void {
    this.undo?.();
    this.undo = null;
    this.source?.disconnect();
    this.source = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }

  /** The bar moved: ease the gain there. */
  level(): void {
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(gainFor(want), this.ctx.currentTime, GAIN_TC);
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
