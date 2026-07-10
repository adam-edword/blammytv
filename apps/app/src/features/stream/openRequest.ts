import type { VodItem } from "./model";

/**
 * Cross-tab mailbox: Discover picks a title, the Stream tab plays host
 * (detail page, sources, the whole playback stage live there). The item
 * parks here because the tab switch UNMOUNTS Discover and mounts
 * StreamScreen — an event alone would fire before the listener exists.
 * App.tsx listens for the event to flip the tab; StreamScreen drains the
 * mailbox on mount (and on the event, for the already-on-Stream case).
 */

const EVENT = "blammytv:open-in-stream";
const RETURN_EVENT = "blammytv:return-to-discover";
let pending: VodItem | null = null;

export function requestOpenInStream(item: VodItem): void {
  pending = item;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function takeOpenRequest(): VodItem | null {
  const p = pending;
  pending = null;
  return p;
}

export function onOpenRequest(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Backing all the way out of a handed-off detail page returns to the
 * Discover tab (where the pick was made), not the Stream home. */
export function requestReturnToDiscover(): void {
  window.dispatchEvent(new CustomEvent(RETURN_EVENT));
}

export function onReturnRequest(cb: () => void): () => void {
  window.addEventListener(RETURN_EVENT, cb);
  return () => window.removeEventListener(RETURN_EVENT, cb);
}
