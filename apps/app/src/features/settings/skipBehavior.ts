import { load, save } from "../../lib/storage";

/** The Skip chip's behavior during VOD playback:
 * - hidden:  never show it
 * - normal:  one chip per skip-worthy chapter
 * - combine: consecutive credits + preview chapters merge into one jump
 * Saving notifies listeners so the overlay flips live. */

export type SkipBehavior = "hidden" | "normal" | "combine";

const KEY = "skipBehavior";
const VERSION = 1;
const EVENT = "blammytv:skip-behavior";
const DEFAULT: SkipBehavior = "normal";

export function loadSkipBehavior(): SkipBehavior {
  const v = load<SkipBehavior>(KEY, VERSION, DEFAULT);
  return v === "hidden" || v === "combine" ? v : "normal";
}

export function saveSkipBehavior(v: SkipBehavior): void {
  save(KEY, VERSION, v);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
}

export function onSkipBehaviorChange(
  cb: (v: SkipBehavior) => void,
): () => void {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<SkipBehavior>).detail;
    cb(d === "hidden" || d === "combine" ? d : "normal");
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
