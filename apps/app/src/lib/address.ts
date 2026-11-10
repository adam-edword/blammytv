import { useSyncExternalStore } from "react";

/**
 * What Classic's address bar needs to say that the header cannot know: the
 * title open on the Stream page, and the page Settings is on. Each owner
 * publishes while it is mounted and clears on the way out, so the bar never
 * keeps a name that has gone.
 */
export interface Address {
  title: string | null;
  settings: string | null;
}

let now: Address = { title: null, settings: null };
const listeners = new Set<() => void>();

export function setAddress(part: Partial<Address>): void {
  const next = { ...now, ...part };
  if (next.title === now.title && next.settings === now.settings) return;
  now = next;
  for (const l of listeners) l();
}

// Module level, so a re-render does not resubscribe (a new function each time
// did, on every clock tick of the header).
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const peek = (): Address => now;

export function useAddress(): Address {
  return useSyncExternalStore(subscribe, peek);
}
