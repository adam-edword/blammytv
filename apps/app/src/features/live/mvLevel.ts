/**
 * The sound tile's level, for the Sound badge's bars (plan 017, "Sound and
 * volume": "so a silent feed looks silent").
 *
 * FROM A COPY, NOT THE ELEMENT ITSELF. Web Audio's MediaElementSource takes
 * an element's audio over for good: from then on it is heard only through
 * the graph, and a context that has not been allowed to start yet is
 * silence. captureStream() copies the element's output instead and leaves
 * its playback alone. The copy's video is stopped at once: only the sound
 * is measured, and copying 60 frames a second to throw away would cost a
 * tile its smoothness.
 */

export type Bands = [number, number, number];

/** One AudioContext for the page: there is only ever one sound tile. */
let ctx: AudioContext | null = null;

/**
 * How many watches are measuring right now. The context runs only while one
 * is, and is suspended otherwise (plan 018, P6): its render thread used to
 * run from the first sound tile to the end of the session, the Guide
 * included. Suspending it is safe for what you hear, because the context
 * only ever listens to a COPY (see the top of this file).
 */
let measuring = 0;

function settle(): void {
  if (!ctx) return;
  if (measuring > 0) void ctx.resume().catch(() => {});
  else if (ctx.state === "running") void ctx.suspend().catch(() => {});
}

/**
 * Low, middle and high, 0 to 1, from an analyser's frequency bins (128 of
 * them at fftSize 256: about 190 Hz each at 48 kHz). Square-rooted so
 * speech moves the bars as visibly as music does.
 */
export function bands(freq: Uint8Array): Bands {
  const avg = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += freq[i] ?? 0;
    return Math.sqrt(sum / (to - from) / 255);
  };
  return [avg(1, 4), avg(4, 16), avg(16, 60)];
}

/** A watch on the sound tile's level (watchLevel). */
export interface LevelWatch {
  /**
   * Measure, or rest. Only while measuring does the frame loop run and write
   * the bars (plan 018, P1): the badge they draw is hidden except for a
   * 3-second flash and on hover, and the loop used to run every frame of
   * the session regardless, restarting three transitions each time.
   */
  run(on: boolean): void;
  /** Rest, and let go of the copy of the sound. */
  stop(): void;
}

/**
 * Watch `video`'s level. Resting until `run(true)`. `onBands` gets
 * [0, 0, 0] while there is nothing to hear.
 */
export function watchLevel(video: HTMLVideoElement, onBands: (b: Bands) => void): LevelWatch {
  const none: LevelWatch = { run: () => {}, stop: () => {} };
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (typeof capture !== "function" || typeof AudioContext === "undefined") return none;
  let stream: MediaStream;
  try {
    stream = capture.call(video);
  } catch {
    return none;
  }
  const audio = (ctx ??= new AudioContext());
  const analyser = audio.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  const data = new Uint8Array(analyser.frequencyBinCount);
  let source: MediaStreamAudioSourceNode | null = null;
  // Tracks arrive when the stream's media does, and again after a retry.
  const attach = () => {
    for (const t of stream.getVideoTracks()) t.stop();
    if (source || stream.getAudioTracks().length === 0) return;
    source = audio.createMediaStreamSource(stream);
    source.connect(analyser);
  };
  attach();
  stream.addEventListener("addtrack", attach);
  // A context made before any click can't start until the page has had
  // one; the next click or key tries again, while this watch measures.
  const wake = () => {
    if (on && audio.state !== "running") void audio.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  let raf = 0;
  let on = false;
  const tick = () => {
    if (source) {
      analyser.getByteFrequencyData(data);
      onBands(bands(data));
    } else {
      onBands([0, 0, 0]);
    }
    raf = requestAnimationFrame(tick);
  };
  const run = (next: boolean) => {
    if (next === on) return;
    on = next;
    measuring += on ? 1 : -1;
    if (on) raf = requestAnimationFrame(tick);
    else cancelAnimationFrame(raf);
    settle();
  };
  // A context made for this watch may start out running: rest it until
  // something measures.
  settle();
  return {
    run,
    stop: () => {
      run(false);
      stream.removeEventListener("addtrack", attach);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      source?.disconnect();
      for (const t of stream.getTracks()) t.stop();
    },
  };
}
