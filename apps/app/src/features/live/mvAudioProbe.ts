/**
 * Why a tile's copy of its sound is silent: a diagnostic, run once a routing
 * by mvAudio.ts when a copy has gone unheard (v0.11.46). It goes once the
 * cause is known.
 *
 * WHAT IS KNOWN. On Adam's WebView2 (Edge 154) the sound tile's
 * `captureStream()` copy, read through Web Audio in the routing's context at
 * 96 kHz (his output's rate), is exact zeros: the tile playing and decoding
 * audio, the copy attached with a live track, the context running, muted or
 * not (v0.11.44's probe). Headless Chromium 141 copies full sound in all of
 * those cases, from a file and from MSE, at 48 and 96 kHz, so the question
 * can only be asked on his machine.
 *
 * WHAT THIS ASKS, each in its own second, then one line for the log:
 * - the copy's track itself, read frame by frame with MediaStreamTrackProcessor,
 *   no Web Audio at all. Zeros here mean the capture is empty at the source
 *   (the tile's audio is not passing through the webview's own renderer);
 *   sound here means Web Audio is where it is lost;
 * - a fresh copy into a context at the default rate, which is how mvLevel
 *   (the Sound badge's bars) listens. Sound here and not in the routing's
 *   means the 96 kHz context is the trouble;
 * - a test tone made in a default-rate context, sent through a MediaStream
 *   into the routing's context. Silence here means that context hears no
 *   stream at all, whatever the tile does;
 * - the copy track's settings and, where Chromium has them, its stats.
 */

/** About -100 dBFS: louder than this is sound. As mvAudio's HEARD. */
const FLOOR = 1e-5;

const db = (p: number) => (p > FLOOR ? `${(20 * Math.log10(p)).toFixed(1)} dBFS` : "silence");
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** The loudest sample an analyser sees over `ms`. */
async function peakOf(an: AnalyserNode, ms: number): Promise<number> {
  const buf = new Float32Array(an.fftSize);
  let p = 0;
  for (const end = performance.now() + ms; performance.now() < end; await wait(40)) {
    an.getFloatTimeDomainData(buf);
    for (const s of buf) p = Math.max(p, Math.abs(s));
  }
  return p;
}

function copyOf(video: HTMLVideoElement): MediaStream {
  const s = (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream();
  for (const t of s.getVideoTracks()) t.stop();
  return s;
}

const stopAll = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Each test in turn; one sentence each. */
async function trackFrames(video: HTMLVideoElement): Promise<string> {
  type Processor = new (init: { track: MediaStreamTrack }) => {
    readable: ReadableStream<AudioData>;
  };
  const P = (window as unknown as { MediaStreamTrackProcessor?: Processor })
    .MediaStreamTrackProcessor;
  if (!P) return "track frames: no MediaStreamTrackProcessor here";
  const s = copyOf(video);
  const track = s.getAudioTracks()[0];
  if (!track) {
    stopAll(s);
    return "track frames: the fresh copy has no audio track";
  }
  const reader = new P({ track }).readable.getReader();
  let frames = 0;
  let peak = 0;
  let fmt = "";
  try {
    for (const end = performance.now() + 1000; performance.now() < end; ) {
      const r = await Promise.race([reader.read(), wait(600).then(() => null)]);
      if (!r || r.done) break;
      const ad = r.value;
      frames++;
      fmt = `${ad.format}, ${ad.sampleRate} Hz, ${ad.numberOfChannels} ch`;
      const buf = new Float32Array(ad.numberOfFrames);
      for (let ch = 0; ch < ad.numberOfChannels; ch++) {
        ad.copyTo(buf, { planeIndex: ch, format: "f32-planar" });
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
      }
      ad.close();
    }
  } catch (e) {
    return `track frames: failed after ${frames} (${errText(e)})`;
  } finally {
    void reader.cancel().catch(() => {});
    stopAll(s);
  }
  return `track frames: ${frames}${fmt ? ` (${fmt})` : ""}, ${db(peak)}`;
}

async function defaultContext(video: HTMLVideoElement): Promise<string> {
  const s = copyOf(video);
  const ctx = new AudioContext();
  try {
    await Promise.race([ctx.resume(), wait(500)]);
    if (s.getAudioTracks().length === 0) return "default-rate context: no audio track";
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    ctx.createMediaStreamSource(s).connect(an);
    const p = await peakOf(an, 1000);
    return `a fresh copy in a default-rate context (${ctx.sampleRate} Hz, ${ctx.state}): ${db(p)}`;
  } catch (e) {
    return `default-rate context: failed (${errText(e)})`;
  } finally {
    stopAll(s);
    void ctx.close().catch(() => {});
  }
}

async function toneThrough(ctx: AudioContext): Promise<string> {
  const maker = new AudioContext();
  try {
    await Promise.race([maker.resume(), wait(500)]);
    const osc = maker.createOscillator();
    const out = maker.createMediaStreamDestination();
    osc.connect(out);
    osc.start();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    const src = ctx.createMediaStreamSource(out.stream);
    src.connect(an);
    const p = await peakOf(an, 800);
    src.disconnect();
    osc.stop();
    return `a test tone through a stream into the routing's ${ctx.sampleRate} Hz context: ${db(p)}`;
  } catch (e) {
    return `test tone: failed (${errText(e)})`;
  } finally {
    void maker.close().catch(() => {});
  }
}

function trackFacts(stream: MediaStream): string {
  const t = stream.getAudioTracks()[0];
  if (!t) return "copy track: none";
  const set = t.getSettings();
  const stats = (t as MediaStreamTrack & { stats?: Record<string, unknown> }).stats;
  const pick = (o: Record<string, unknown> | undefined, keys: string[]) =>
    o ? keys.filter((k) => o[k] !== undefined).map((k) => `${k} ${String(o[k])}`) : [];
  const facts = [
    ...pick(set as Record<string, unknown>, ["sampleRate", "channelCount", "sampleSize", "latency"]),
    ...pick(stats, ["deliveredFrames", "totalFrames", "deliveredFramesDuration", "totalFramesDuration"]),
  ];
  return `copy track: ${facts.join(", ") || "no settings"}`;
}

/**
 * Ask, and return the one line. `stream` is the routing's own copy, `ctx`
 * its context. Never throws.
 */
export async function probeCopy(
  video: HTMLVideoElement,
  stream: MediaStream,
  ctx: AudioContext,
): Promise<string> {
  const said: string[] = [trackFacts(stream)];
  for (const ask of [
    () => trackFrames(video),
    () => defaultContext(video),
    () => toneThrough(ctx),
  ]) {
    try {
      said.push(await ask());
    } catch (e) {
      said.push(`failed (${errText(e)})`);
    }
  }
  return `[mv] sound copy tests: ${said.join("; ")}.`;
}
