/**
 * AIOStreams' sync account on this device (plan 023): signing out of it, and
 * noticing when AIOStreams has signed it out. Every call the app makes goes
 * through `aioCall`, so a 401 is seen in one place.
 */

import { aiojfDisconnect, aiojfJson, aiojfStatus } from "./client";
import { AIOJF_SYNCED, forgetAiojf } from "./store";

let signingOut: Promise<void> | null = null;

/** Forget AIOStreams' sync on this device: the session (the token is the
 * native side's to drop), the bookkeeping, the queue, the ticks. Your
 * watch state on AIOStreams is not touched. Concurrent callers share one
 * sign-out: Clear All Login Info empties the AIOStreams URL, which signs out
 * too, and asks for it as well. */
export function signOutOfAio(): Promise<void> {
  signingOut ??= (async () => {
    await aiojfDisconnect().catch(() => {});
    forgetAiojf();
    window.dispatchEvent(new Event(AIOJF_SYNCED));
  })().finally(() => {
    signingOut = null;
  });
  return signingOut;
}

/**
 * AIOStreams answered 401: the native side has dropped the token, and says
 * so in its status. When it does, what this device kept for that account
 * goes too, since the next connect may be another user's.
 */
export async function reconcile(): Promise<void> {
  const s = await aiojfStatus();
  if (s.connected) return;
  forgetAiojf();
  window.dispatchEvent(new Event(AIOJF_SYNCED));
}

/** A request to AIOStreams' Jellyfin side, with a 401 reconciled. */
export async function aioCall<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
) {
  const r = await aiojfJson<T>(method, path, opts);
  if (r.status === 401) void reconcile().catch(() => {});
  return r;
}
