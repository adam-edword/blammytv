import type { VodItem } from "./model";
import type { WatchEntry } from "./watching";

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

/**
 * Resume hand-off: the Library tab's Continue Watching cards. Same reason
 * as the item mailbox above, and deliberately the same shape: playback
 * lives in StreamScreen, so the Library asks rather than plays. Carries the
 * whole WatchEntry because quick-resume needs the position and the episode
 * identity, not just an id.
 */
const RESUME_EVENT = "blammytv:resume-in-stream";
let pendingResume: WatchEntry | null = null;

export function requestResumeInStream(entry: WatchEntry): void {
  pendingResume = entry;
  origin = "mylist";
  window.dispatchEvent(new CustomEvent(RESUME_EVENT));
}

export function takeResumeRequest(): WatchEntry | null {
  const p = pendingResume;
  pendingResume = null;
  return p;
}

export function onResumeRequest(cb: () => void): () => void {
  window.addEventListener(RESUME_EVENT, cb);
  return () => window.removeEventListener(RESUME_EVENT, cb);
}

/** Genre hand-off: a genre pill on the detail screens opens Discover
 * with that genre selected. Same mailbox pattern as the item hand-off —
 * the nav flip unmounts/mounts DiscoverScreen, which drains on mount. */
const GENRE_EVENT = "blammytv:open-genre-in-discover";
let pendingGenre: string | null = null;

export function requestDiscoverGenre(genre: string): void {
  pendingGenre = genre;
  window.dispatchEvent(new CustomEvent(GENRE_EVENT));
}

export function takeGenreRequest(): string | null {
  const g = pendingGenre;
  pendingGenre = null;
  return g;
}

export function onGenreRequest(cb: () => void): () => void {
  window.addEventListener(GENRE_EVENT, cb);
  return () => window.removeEventListener(GENRE_EVENT, cb);
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
