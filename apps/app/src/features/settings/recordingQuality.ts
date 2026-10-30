import { tauriRecSetSmaller } from "../../lib/tauri";
import { load, save } from "../../lib/storage";

/**
 * Settings → Playback → Recordings → Recording Quality (plan 029, Phase 4):
 * keep a finished recording as it was recorded, or have native re-encode it
 * to HEVC once it is repackaged. Original Quality is the default and what the
 * app did before the choice existed. A stored value this build doesn't offer
 * reads as the default.
 *
 * Native owns the work, so the page says the choice: once at launch, and again
 * on every change, Original Quality included (that drops the shrinks that have
 * not started). A shrink left from the last run waits for the first call. The
 * same value twice is one call: StrictMode runs the launch effect twice in dev.
 *
 * A native build from before v1.0.14 has no such command, and the call
 * rejects. That is caught here and shown to no one: the setting still saves.
 * A failed push is forgotten, so the next change tries again.
 */
export type RecordingQuality = "original" | "smaller";

/** The picker options, in the order Settings draws them. */
export const RECORDING_QUALITY_TABS: Array<{ key: RecordingQuality; label: string }> = [
  { key: "original", label: "Original Quality" },
  { key: "smaller", label: "Smaller Files" },
];

const KEY = "recordingQuality";
const EVENT = "blammytv:recording-quality";
const as = (x: unknown): RecordingQuality => (x === "smaller" ? "smaller" : "original");

export const loadRecordingQuality = (): RecordingQuality => as(load<unknown>(KEY, 1, "original"));

/** Saving tells the listeners, so the push below follows a change made here. */
export function saveRecordingQuality(v: RecordingQuality): void {
  save(KEY, 1, v);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
}

export function onRecordingQualityChange(cb: (v: RecordingQuality) => void): () => void {
  const handler = (e: Event) => cb(as((e as CustomEvent<unknown>).detail));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

let last: boolean | null = null;

export function pushRecordingQuality(): void {
  const on = loadRecordingQuality() === "smaller";
  if (on === last) return;
  last = on;
  tauriRecSetSmaller(on).catch((err) => {
    last = null;
    console.info("[rec] native did not take the recording quality:", String(err));
  });
}

/** Push now and on every change. Returns the way to stop. */
export function watchRecordingQuality(): () => void {
  pushRecordingQuality();
  return onRecordingQualityChange(pushRecordingQuality);
}

/** For tests: forget what was pushed. */
export function resetRecordingQualitySync(): void {
  last = null;
}
