/**
 * What BlammyTV remembers about a Jellyfin server between runs (plan 027).
 * None of it is a credential: the token lives in the OS vault (jf.rs). This is
 * bookkeeping, so a screen can tell whether a server is connected, and where,
 * without asking the native side while it renders.
 */

import { load, save } from "../../lib/storage";
import type { JfStatus } from "./client";

export interface JfLocal {
  /**
   * The sign-in this device holds, kept so Stream and Discover can choose
   * their rows without a round trip (`loadJfConn`). Nothing secret: the token
   * stays native. Written by `noteSignIn`, gone with everything `forgetJf`
   * clears.
   */
  signedIn?: { base: string; userName?: string; userId?: string; serverName?: string };
  /** The last thing that went wrong, said plainly, for Settings. */
  problem?: string;
}

const KEY = "jellyfin";
const VERSION = 1;

export function loadJf(): JfLocal {
  return load<JfLocal>(KEY, VERSION, {});
}

export function saveJf(patch: Partial<JfLocal>): JfLocal {
  const next = { ...loadJf(), ...patch };
  save(KEY, VERSION, next);
  return next;
}

/** Said when the sign-in changed (signed in, signed out, or a 401 ended it), so
 * a screen that reads it re-reads. */
export const JF_CHANGED = "blammytv:jf-changed";

/** Bumped by every sign-out, so a read already under way can tell it has been
 * overtaken and write nothing back into the store it just cleared. */
let forgets = 0;
export const forgetCount = (): number => forgets;

/** Signed out: the bookkeeping goes. Titles and watch state that came from
 * the server stay in Continue Watching and the ledgers, as Trakt's do. */
export function forgetJf(): void {
  forgets++;
  save(KEY, VERSION, {});
}

/**
 * Keep `signedIn` in step with what the native side says (`account.ts`
 * `readSignIn` calls this with every status it reads). A connected status with
 * a base records the sign-in; anything else clears it. A status that says the
 * build has no Jellyfin at all tells nothing, so it changes nothing.
 * Returns whether the record changed.
 */
export function noteSignIn(s: JfStatus): boolean {
  if (!s.supported) return false;
  const now = loadJf().signedIn;
  if (s.connected && s.base) {
    const next = {
      base: s.base,
      ...(s.userName ? { userName: s.userName } : {}),
      ...(s.userId ? { userId: s.userId } : {}),
      ...(s.serverName ? { serverName: s.serverName } : {}),
    };
    if (
      now?.base === next.base &&
      now.userName === next.userName &&
      now.userId === next.userId &&
      now.serverName === next.serverName
    )
      return false;
    saveJf({ signedIn: next, problem: undefined });
    return true;
  }
  if (!now) return false;
  saveJf({ signedIn: undefined });
  return true;
}

/** The connection Stream and Discover read a Jellyfin server through now, or
 * null when none is signed in. Sync, so a screen can gate on it. `key` names
 * it for caches: the server and the user, no secret. */
export interface JfConn {
  base: string;
  userId: string;
  key: string;
}

export function loadJfConn(): JfConn | null {
  const si = loadJf().signedIn;
  if (!si || typeof si.base !== "string" || !si.base || !si.userId) return null;
  return { base: si.base, userId: si.userId, key: `jf:${si.base}|${si.userId}` };
}
