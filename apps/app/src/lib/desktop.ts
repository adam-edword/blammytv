/**
 * Bridge to the desktop (Electron) shell. Undefined in a plain browser, so
 * callers fall back to playing the stream directly.
 */
export interface SourceStats {
  /** Source video stream (from ffprobe). */
  source: {
    width: number | null;
    height: number | null;
    codec: string | null;
    pixFmt: string | null;
    frameRate: string | null;
    bitRate: number | null;
  } | null;
  /** Source audio sample rate (Hz) — we don't resample, so it's also delivered. */
  audioSampleRate: number | null;
  /** Whether the video is being tone-mapped from HDR. */
  hdr: boolean;
  /** What the player actually receives. */
  delivered: { audioCodec: string; audioChannels: number; audioBitrateKbps: number };
}

interface BlammyBridge {
  transcodeStart: (
    url: string,
  ) => Promise<{ ok: boolean; url?: string; error?: string; stats?: SourceStats }>;
  transcodeStop: () => Promise<unknown>;
  popoutPlay: (url: string) => Promise<{ ok: boolean; error?: string }>;
  popoutStop: () => Promise<unknown>;
  onPopoutClosed: (cb: () => void) => () => void;
  mpvSpike: (url: string) => Promise<{ ok: boolean; error?: string }>;
  mpvRenderProbe: (
    url: string,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  mpvPlayerStart: (
    url: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  mpvPlayerFrame: (w: number, h: number) => Promise<Uint8Array | null>;
  mpvPlayerStop: () => Promise<unknown>;
}

/**
 * In-renderer libmpv bridge (loaded by the preload from the native addon, so
 * its frame pulls are synchronous + IPC-free — the canvas hot path).
 */
interface BlammyMpvBridge {
  start: (url: string) => { ok: boolean; error?: string };
  frame: (w: number, h: number) => Uint8Array | null;
  stop: () => void;
  stats: () => string;
}

const bridge = (window as unknown as { blammy?: BlammyBridge }).blammy;
const mpvBridge = (window as unknown as { blammyMpv?: BlammyMpvBridge })
  .blammyMpv;

export const isDesktop = (): boolean => !!bridge;

/** Start the local ffmpeg→HLS transcode; resolves to a playable HLS URL. */
export const transcodeStart = (url: string) => bridge?.transcodeStart(url);
export const transcodeStop = () => bridge?.transcodeStop();

/** Play the stream in a native mpv popout window. */
export const popoutPlay = (url: string) => bridge?.popoutPlay(url);
export const popoutStop = () => bridge?.popoutStop();
export const onPopoutClosed = (cb: () => void): (() => void) =>
  bridge?.onPopoutClosed(cb) ?? (() => {});

/** Phase 1 libmpv spike — play the source directly via the native addon. */
export const mpvSpike = (url: string) => bridge?.mpvSpike(url);

/** Phase 2 step 1 — render one frame offscreen via mpv's render API → BMP. */
export const mpvRenderProbe = (url: string) => bridge?.mpvRenderProbe(url);

/** Phase 2 step 2 — live libmpv → canvas player (synchronous, in-renderer). */
export const mpvCanvasStart = (url: string) =>
  mpvBridge?.start(url) ?? { ok: false, error: "libmpv bridge unavailable" };
export const mpvCanvasFrame = (w: number, h: number) =>
  mpvBridge?.frame(w, h) ?? null;
export const mpvCanvasStop = () => mpvBridge?.stop();
export const mpvCanvasStats = (): string => mpvBridge?.stats() ?? "";
