/**
 * Bridge to the desktop (Electron) shell. Undefined in a plain browser or in the
 * Tauri build, so callers fall back to playing the stream another way.
 */
interface BlammyBridge {
  popoutPlay: (url: string) => Promise<{ ok: boolean; error?: string }>;
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
  setPause: (paused: boolean) => void;
  setMute: (muted: boolean) => void;
  setVolume: (vol: number) => void;
  seek: (delta: number) => void;
}

const bridge = (window as unknown as { blammy?: BlammyBridge }).blammy;
const mpvBridge = (window as unknown as { blammyMpv?: BlammyMpvBridge })
  .blammyMpv;

export const isDesktop = (): boolean => !!bridge;

/** Play the stream in a native mpv popout window. */
export const popoutPlay = (url: string) => bridge?.popoutPlay(url);

/** Live libmpv → canvas player (synchronous, in-renderer). */
export const mpvCanvasStart = (url: string) =>
  mpvBridge?.start(url) ?? { ok: false, error: "libmpv bridge unavailable" };
export const mpvCanvasFrame = (w: number, h: number) =>
  mpvBridge?.frame(w, h) ?? null;
export const mpvCanvasStop = () => mpvBridge?.stop();
export const mpvCanvasStats = (): string => mpvBridge?.stats() ?? "";
export const mpvCanvasSetPause = (paused: boolean) =>
  mpvBridge?.setPause(paused);
export const mpvCanvasSetMute = (muted: boolean) => mpvBridge?.setMute(muted);
/** vol is 0..1 (UI scale); mpv uses 0..100. */
export const mpvCanvasSetVolume = (vol: number) =>
  mpvBridge?.setVolume(Math.round(vol * 100));
export const mpvCanvasSeek = (delta: number) => mpvBridge?.seek(delta);
