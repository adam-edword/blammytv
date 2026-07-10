/**
 * Header 🔍 → Discover's search bar. Same mailbox shape as the Stream
 * hand-off: the tab switch mounts DiscoverScreen AFTER the click, so an
 * event alone would fire before the listener exists — the flag survives
 * until the screen drains it and focuses the input.
 */

const EVENT = "blammytv:open-search";
let pending = false;

export function requestSearch(): void {
  pending = true;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function takeSearchRequest(): boolean {
  const p = pending;
  pending = false;
  return p;
}

export function onSearchRequest(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
