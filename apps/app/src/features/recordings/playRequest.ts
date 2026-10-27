/**
 * Library's Play on a recording (plan 029, D4). Recordings play in one place,
 * Live TV's player: Library asks, App flips to the Guide tab, and the Guide
 * takes the recording as it mounts, in Recordings mode. The mailbox shape of
 * multiviewEntry's Watch in player.
 */
const EVENT = "blammytv:play-recording";
let pending: string | null = null;

export function requestPlayRecording(id: string): void {
  pending = id;
  window.dispatchEvent(new Event(EVENT));
}

export function onPlayRecordingRequest(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** The recording asked for, once: reading it clears it. */
export function takePlayRecordingRequest(): string | null {
  const id = pending;
  pending = null;
  return id;
}
