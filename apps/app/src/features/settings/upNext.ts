import { load, save } from "../../lib/storage";

/**
 * Up Next (plan 025, P3a): two settings for the card that offers the next
 * episode.
 *
 * AUTOPLAY is the end-of-file card: whether it counts down and plays on its
 * own, and from how long. It was a fixed 10 seconds. Read when the card
 * arms, so a change applies to the next card and never to one on screen.
 *
 * THE CARD is the corner card shown while an episode's credits still play:
 * at the credits (the overlay's creditsWindow rule, as it always was), in the
 * last minute, or never. The end-of-file card is not this one; it is
 * Autoplay's. Saving notifies listeners so the overlay flips live.
 */

/** Seconds the end-of-file card counts down from. 0 is off: it waits. */
export const AUTOPLAY_CHOICES = [0, 5, 10, 20] as const;
export type AutoplayNext = (typeof AUTOPLAY_CHOICES)[number];

/** The picker options. Keys are the seconds, as text. */
export const AUTOPLAY_TABS: Array<{ key: string; label: string }> = [
  { key: "0", label: "Off" },
  { key: "5", label: "5s" },
  { key: "10", label: "10s" },
  { key: "20", label: "20s" },
];

const AUTOPLAY_KEY = "autoplayNext";
const AUTOPLAY_DEFAULT: AutoplayNext = 10;

export function loadAutoplayNext(): AutoplayNext {
  const v = load<unknown>(AUTOPLAY_KEY, 1, AUTOPLAY_DEFAULT);
  return AUTOPLAY_CHOICES.find((c) => c === v) ?? AUTOPLAY_DEFAULT;
}

export function saveAutoplayNext(v: AutoplayNext): void {
  save(AUTOPLAY_KEY, 1, v);
}

/** What the end-of-file card counts down from: null when it waits instead. */
export function countdownFrom(v: AutoplayNext): number | null {
  return v === 0 ? null : v;
}

export type UpNextCard = "credits" | "last" | "never";

/** The picker options. */
export const UP_NEXT_CARD_TABS: Array<{ key: UpNextCard; label: string }> = [
  { key: "credits", label: "At the credits" },
  { key: "last", label: "Last minute" },
  { key: "never", label: "Never" },
];

/** How close to the end "Last minute" is, in seconds. */
export const LAST_MINUTE = 60;

const CARD_KEY = "upNextCard";
const CARD_EVENT = "blammytv:up-next-card";
const CARD_DEFAULT: UpNextCard = "credits";

const asCard = (x: unknown): UpNextCard => (x === "last" || x === "never" ? x : CARD_DEFAULT);

export function loadUpNextCard(): UpNextCard {
  return asCard(load<unknown>(CARD_KEY, 1, CARD_DEFAULT));
}

export function saveUpNextCard(v: UpNextCard): void {
  save(CARD_KEY, 1, v);
  window.dispatchEvent(new CustomEvent(CARD_EVENT, { detail: v }));
}

export function onUpNextCardChange(cb: (v: UpNextCard) => void): () => void {
  const handler = (e: Event) => cb(asCard((e as CustomEvent<unknown>).detail));
  window.addEventListener(CARD_EVENT, handler);
  return () => window.removeEventListener(CARD_EVENT, handler);
}

/**
 * Whether the corner card's window is open, for the host. `creditsNow` is the
 * overlay's own reading of the credits (markers, then chapters), kept apart
 * from this on purpose: it doesn't know what the card is set to. Live and
 * unknown durations never open it.
 */
export function upNextWindow(
  card: UpNextCard,
  creditsNow: boolean,
  time: { pos: number; dur: number } | null,
): boolean {
  if (card === "never") return false;
  if (card === "credits") return creditsNow;
  return !!time && time.dur > 0 && time.dur - time.pos <= LAST_MINUTE;
}
