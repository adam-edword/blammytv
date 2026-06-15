/**
 * Bridge to the desktop (Electron) shell. Undefined in a plain browser, so
 * callers fall back to web playback.
 */
/** Viewport-relative rect of the player region (DIP); main converts to screen. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BlammyBridge {
  mpvPlay: (url: string, rect?: Rect) => Promise<{ ok: boolean; error?: string }>;
  mpvSetBounds: (rect: Rect) => Promise<unknown>;
  mpvStop: () => Promise<unknown>;
  onMpvClosed: (cb: () => void) => () => void;
  onWindowGeom: (cb: () => void) => () => void;
}

const bridge = (window as unknown as { blammy?: BlammyBridge }).blammy;

export const isDesktop = (): boolean => !!bridge;
export const mpvPlay = (url: string, rect?: Rect) => bridge?.mpvPlay(url, rect);
export const mpvSetBounds = (rect: Rect) => bridge?.mpvSetBounds(rect);
export const mpvStop = () => bridge?.mpvStop();
export const onMpvClosed = (cb: () => void): (() => void) =>
  bridge?.onMpvClosed(cb) ?? (() => {});
export const onWindowGeom = (cb: () => void): (() => void) =>
  bridge?.onWindowGeom(cb) ?? (() => {});
