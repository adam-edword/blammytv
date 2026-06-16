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
}

const bridge = (window as unknown as { blammy?: BlammyBridge }).blammy;

export const isDesktop = (): boolean => !!bridge;

/** Start the local ffmpeg→HLS transcode; resolves to a playable HLS URL. */
export const transcodeStart = (url: string) => bridge?.transcodeStart(url);
export const transcodeStop = () => bridge?.transcodeStop();

/** Play the stream in a native mpv popout window. */
export const popoutPlay = (url: string) => bridge?.popoutPlay(url);
export const popoutStop = () => bridge?.popoutStop();
export const onPopoutClosed = (cb: () => void): (() => void) =>
  bridge?.onPopoutClosed(cb) ?? (() => {});
