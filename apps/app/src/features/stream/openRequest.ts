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

/**
 * ...and WHICH list inside the Library, when that is where it came from.
 *
 * The tab alone stopped being enough when the Library became a page of
 * LISTS. Backing out of a title returned to "mylist" and landed at that
 * page's root, so you lost the list you had open and had to find it again.
 * LibraryScreen's view stack is component state and the hand-off unmounts
 * it, so the list id has to travel out here and be picked back up.
 *
 * PEEK AND CLEAR, not take-once: LibraryScreen seeds its view stack from
 * this in a lazy useState initializer, and StrictMode double-invokes those
 * in dev. A consuming read would hand the list to the first invocation and
 * null to the second — the same class of bug viewStack.ts calls out at the
 * top of its own file.
 */
let originList: string | null = null;

export function requestOpenInStream(
  item: VodItem,
  from: OpenOrigin = "discover",
  list: string | null = null,
): void {
  pending = item;
  origin = from;
  originList = list;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Which list to reopen, or null. Pure — safe to call while rendering. */
export function peekReturnList(): string | null {
  return originList;
}

/** Drop it, once the screen that wanted it has mounted. */
export function clearReturnList(): void {
  originList = null;
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

/** What the Library asked for. "resume" quick-resumes into playback (the
 * card body); "sources" lands the source list without playing anything (the
 * Sources chip, and the title/meta line beside it). Both ride the SAME
 * mailbox and event so there is one tab-flip listener in App.tsx rather
 * than two — a second one is exactly the wiring that went missing before
 * and made a click do nothing at all. */
export type ResumeIntent = "resume" | "sources";
export interface ResumeRequest {
  entry: WatchEntry;
  intent: ResumeIntent;
}
let pendingResume: ResumeRequest | null = null;

export function requestResumeInStream(entry: WatchEntry): void {
  pendingResume = { entry, intent: "resume" };
  origin = "mylist";
  window.dispatchEvent(new CustomEvent(RESUME_EVENT));
}

/** The Sources chip: show me where this comes from, do not start playing.
 * Quick-resume auto-plays the first CACHED source, which is the opposite of
 * what someone asking for the source list wants. */
export function requestSourcesInStream(entry: WatchEntry): void {
  pendingResume = { entry, intent: "sources" };
  origin = "mylist";
  window.dispatchEvent(new CustomEvent(RESUME_EVENT));
}

export function takeResumeRequest(): ResumeRequest | null {
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
