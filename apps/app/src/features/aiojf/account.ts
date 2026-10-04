/**
 * AIOStreams' sync account on this device (plan 023): signing out of it, and
 * noticing when AIOStreams has signed it out. Every call the app makes goes
 * through `aioCall`, so a 401 is seen in one place.
 */

import {
  aiojfCanSource,
  aiojfDisconnect,
  aiojfJson,
  aiojfSources,
  aiojfStatus,
  type AiojfStatus,
  type SourcesReply,
} from "./client";
import { AIOJF_SYNCED, forgetAiojf, forgetCount, noteSignIn } from "./store";

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

/**
 * The native side's status, and the sign-in this device holds brought in step
 * with it (store.ts `noteSignIn`): Stream reads AIOStreams over the sign-in
 * only while that is recorded. A sign-out that lands while the status is on
 * its way wins, so a stale "connected" never writes it back.
 */
export async function readSignIn(): Promise<AiojfStatus> {
  const gen = forgetCount();
  const s = await aiojfStatus();
  const canSource = s.connected ? await aiojfCanSource() : false;
  if (gen === forgetCount()) noteSignIn(s, canSource);
  return s;
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

/** The stream search for one title (`aiojf_sources`), with a 401 reconciled
 * as `aioCall` does. */
export async function aioSources(itemId: string, refresh: boolean): Promise<SourcesReply> {
  const r = await aiojfSources(itemId, refresh);
  if (r.status === 401) void reconcile().catch(() => {});
  return r;
}
