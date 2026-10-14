/**
 * The Jellyfin account on this device (plan 027): signing out of it, and
 * noticing when the server has signed it out. Every call the app makes goes
 * through `jfCall`, so a 401 is seen in one place.
 */

import { jfDisconnect, jfJson, jfStatus, type JfStatus } from "./client";
import { JF_CHANGED, forgetCount, forgetJf, noteSignIn } from "./store";

let signingOut: Promise<boolean> | null = null;

/** Forget the Jellyfin server on this device: the session (the token is the
 * native side's to drop, and to revoke on the server), then the bookkeeping.
 * Your watch state on the server is not touched. Concurrent callers share one
 * sign-out. Resolves to whether the server confirmed the revoke: false means it
 * could not be reached and the token still stands there. */
export function signOutOfJf(): Promise<boolean> {
  signingOut ??= (async () => {
    const revoked = await jfDisconnect().catch(() => false);
    forgetJf();
    window.dispatchEvent(new Event(JF_CHANGED));
    return revoked;
  })().finally(() => {
    signingOut = null;
  });
  return signingOut;
}

/**
 * The server answered 401: the native side has dropped the token, and says so
 * in its status. When it does, what this device kept for that account goes
 * too, since the next sign-in may be another user's.
 */
export async function reconcile(): Promise<void> {
  const s = await jfStatus();
  if (s.connected || !s.supported) return;
  forgetJf();
  window.dispatchEvent(new Event(JF_CHANGED));
}

/**
 * The native side's status, and the sign-in this device holds brought in step
 * with it (store.ts `noteSignIn`). A sign-out that lands while the status is on
 * its way wins, so a stale "connected" never writes it back. Says JF_CHANGED
 * when the record changed.
 */
export async function readSignIn(): Promise<JfStatus> {
  const gen = forgetCount();
  const s = await jfStatus();
  if (gen === forgetCount() && noteSignIn(s)) window.dispatchEvent(new Event(JF_CHANGED));
  return s;
}

/** A request to the server, with a 401 reconciled. */
export async function jfCall<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
) {
  const r = await jfJson<T>(method, path, opts);
  if (r.status === 401) void reconcile().catch(() => {});
  return r;
}
