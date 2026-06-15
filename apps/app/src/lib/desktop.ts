/**
 * Bridge to the desktop (Electron) shell. Undefined in a plain browser, so
 * callers fall back to web playback.
 */
interface BlammyBridge {
  mpvPlay: (url: string) => Promise<{ ok: boolean; error?: string }>;
  mpvStop: () => Promise<unknown>;
}

const bridge = (window as unknown as { blammy?: BlammyBridge }).blammy;

export const isDesktop = (): boolean => !!bridge;
export const mpvPlay = (url: string) => bridge?.mpvPlay(url);
export const mpvStop = () => bridge?.mpvStop();
