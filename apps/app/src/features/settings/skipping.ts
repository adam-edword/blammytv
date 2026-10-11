import { load, save } from "../../lib/storage";

/**
 * What the player does at each kind of skippable stretch (plan 025, P3a).
 * Skip Behavior was one choice for all of them (hidden, normal, combine);
 * this is one per type, and the combine switch beside them.
 *
 * - button: the Skip chip, for that type only
 * - auto:   the player seeks to the end of it, once per stretch per play
 * - off:    nothing for that type
 *
 * Saving notifies listeners so the overlay flips live.
 */

export type SkipType = "intro" | "recap" | "credits" | "preview";
export type SkipMode = "button" | "auto" | "off";

export interface Skipping {
  intro: SkipMode;
  recap: SkipMode;
  credits: SkipMode;
  preview: SkipMode;
  /** A run of credits and preview chapters is one jump, taking Credits' mode. */
  combine: boolean;
}

/** The four lines, in the order Settings draws them. */
export const SKIP_LINES: Array<{ type: SkipType; label: string }> = [
  { type: "intro", label: "Intro" },
  { type: "recap", label: "Recap" },
  { type: "credits", label: "Credits" },
  { type: "preview", label: "Preview" },
];

/** The picker options for each line. */
export const SKIP_MODES: Array<{ key: SkipMode; label: string }> = [
  { key: "button", label: "Button" },
  { key: "auto", label: "Automatic" },
  { key: "off", label: "Off" },
];

const KEY = "skipping";
const VERSION = 1;
const EVENT = "blammytv:skipping";
/** The key this replaced. Read once, to carry a choice across. */
const OLD_KEY = "skipBehavior";
const OLD_VERSION = 1;

/** Today's "normal": every type a button, credits and preview apart. */
export const DEFAULT_SKIPPING: Skipping = {
  intro: "button",
  recap: "button",
  credits: "button",
  preview: "button",
  combine: false,
};

const isMode = (x: unknown): x is SkipMode => x === "button" || x === "auto" || x === "off";

/** Anything stored or sent, as a Skipping: a field that isn't right takes its default. */
export function normalizeSkipping(raw: unknown): Skipping {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode = (t: SkipType): SkipMode => (isMode(o[t]) ? o[t] : DEFAULT_SKIPPING[t]);
  return {
    intro: mode("intro"),
    recap: mode("recap"),
    credits: mode("credits"),
    preview: mode("preview"),
    combine: o.combine === true,
  };
}

/**
 * What the old Skip Behavior meant, as the new settings: hidden is every type
 * off, combine is every type a button with the switch on. Normal (and anything
 * the old loader would have read as normal) is the defaults, so it needs
 * nothing stored. Null for those.
 */
export function fromSkipBehavior(old: unknown): Skipping | null {
  if (old === "hidden") return { intro: "off", recap: "off", credits: "off", preview: "off", combine: false };
  if (old === "combine") return { ...DEFAULT_SKIPPING, combine: true };
  return null;
}

export function loadSkipping(): Skipping {
  const stored = load<unknown>(KEY, VERSION, undefined);
  if (stored !== undefined) return normalizeSkipping(stored);
  // Nothing under the new key yet: carry the old choice over, once. Saved, so
  // this is the last time the old key is looked at.
  const carried = fromSkipBehavior(load<unknown>(OLD_KEY, OLD_VERSION, undefined));
  if (!carried) return DEFAULT_SKIPPING;
  save(KEY, VERSION, carried);
  return carried;
}

export function saveSkipping(v: Skipping): void {
  const next = normalizeSkipping(v);
  save(KEY, VERSION, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function onSkippingChange(cb: (v: Skipping) => void): () => void {
  const handler = (e: Event) => cb(normalizeSkipping((e as CustomEvent<unknown>).detail));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
