/**
 * How the app reaches AIOStreams (plan 024): one answer for "is it set up"
 * and "where to ask".
 *
 * Signed in, Stream, Discover and the hero picker read AIOStreams over its
 * Jellyfin side (remote.ts). Without a sign-in they read the manifest URL as
 * before (D1: it stays as the fallback). A sign-in wins when this device
 * holds one (`signedIn`, store.ts), and a build that cannot open sources by
 * sign-in never records one, so it stays on its manifest.
 */

import { loadAioUrl } from "../settings/aiostreams";
import { loadAiojf } from "./store";

export type AioConn =
  | { kind: "signin"; base: string; key: string }
  | { kind: "manifest"; url: string; key: string };

export type SignInConn = Extract<AioConn, { kind: "signin" }>;

/**
 * The connection to read AIOStreams through now, or null when none is set up.
 * Sync, so a screen can gate on it while it renders.
 *
 * `key` names the connection for caches: `signin:<base>|<user>` or
 * `manifest:<url>`. It holds the manifest URL, which is a credential, so it
 * is never logged or shown.
 */
export function loadAioConn(): AioConn | null {
  const si = loadAiojf().signedIn;
  if (si && typeof si.base === "string" && si.base) {
    return { kind: "signin", base: si.base, key: `signin:${si.base}|${si.userName ?? ""}` };
  }
  const url = loadAioUrl();
  return url ? { kind: "manifest", url, key: `manifest:${url}` } : null;
}
