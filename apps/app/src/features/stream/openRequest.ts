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
