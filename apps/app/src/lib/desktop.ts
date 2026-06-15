/**
 * Bridge to the desktop (Electron) shell. Undefined in a plain browser, so
 * callers fall back to web playback.
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BlammyBridge {
  mpvPlay: (url: string, bounds?: Bounds) => Promise<{ ok: boolean; error?: string }>;
  mpvSetBounds: (bounds: Bounds) => Promise<unknown>;
  mpvStop: () => Promise<unknown>;
  onMpvClosed: (cb: () => void) => () => void;
  onWindowGeom: (cb: () => void) => () => void;
}

const bridge = (window as unknown as { blammy?: BlammyBridge }).blammy;

export const isDesktop = (): boolean => !!bridge;
export const mpvPlay = (url: string, bounds?: Bounds) => bridge?.mpvPlay(url, bounds);
export const mpvSetBounds = (bounds: Bounds) => bridge?.mpvSetBounds(bounds);
export const mpvStop = () => bridge?.mpvStop();
export const onMpvClosed = (cb: () => void): (() => void) =>
  bridge?.onMpvClosed(cb) ?? (() => {});
export const onWindowGeom = (cb: () => void): (() => void) =>
  bridge?.onWindowGeom(cb) ?? (() => {});
