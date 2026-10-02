/**
 * Trakt's account on this device (plan 015): how long since it synced, in
 * words, and forgetting it.
 */

import { dropTraktList } from "../stream/lists";
import { traktDisconnect } from "./client";
import { forgetTrakt, TRAKT_SYNCED } from "./store";

/** "5 minutes ago", roughly, for when it last synced. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Forget Trakt on this device: the session, the bookkeeping, the list. */
export async function signOutOfTrakt(): Promise<void> {
  await traktDisconnect().catch(() => {});
  forgetTrakt();
  dropTraktList();
  window.dispatchEvent(new Event(TRAKT_SYNCED));
}
