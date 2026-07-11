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

/** Which grid the hand-off came from — backing all the way out returns
 * THERE, not to a hardcoded tab. */
export type OpenOrigin = "discover" | "mylist";
let origin: OpenOrigin = "discover";

export function requestOpenInStream(
  item: VodItem,
  from: OpenOrigin = "discover",
): void {
  pending = item;
  origin = from;
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
 * grid where the pick was made (Discover or My List), not Stream home. */
export function requestReturnToDiscover(): void {
  window.dispatchEvent(new CustomEvent(RETURN_EVENT, { detail: origin }));
}

export function onReturnRequest(cb: (from: OpenOrigin) => void): () => void {
  const handler = (e: Event) =>
    cb(((e as CustomEvent).detail as OpenOrigin) ?? "discover");
  window.addEventListener(RETURN_EVENT, handler);
  return () => window.removeEventListener(RETURN_EVENT, handler);
}
