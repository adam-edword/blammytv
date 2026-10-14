import { useCallback, useEffect, useRef, useState } from "react";
import { scrubbedMessage } from "../../lib/errors";
import { readSignIn } from "./account";
import { jfPoll, jfQuickConnect, jfSignIn, type JfQuickConnect, type JfStatus } from "./client";

/**
 * Signing in to a Jellyfin server from Settings → Sources → Stream (plan 027,
 * D2): by user name and password, or by Quick Connect.
 *
 * Password: one call, and the status comes back signed in. Quick Connect: the
 * app shows a 6-digit code, you type it into Jellyfin's own page (user menu,
 * Quick Connect), and the app notices on its own. The code and the polling live
 * in the component that holds this and stop with it. The password goes to
 * native once and is not kept anywhere on the page past the call; the token
 * never comes near it (jf.rs keeps it in Windows Credential Manager).
 */
export type JfSignInPhase =
  | { at: "idle"; note?: string }
  /** The address is being checked and a sign-in or a code asked for. */
  | { at: "starting" }
  | { at: "code"; start: JfQuickConnect };

/** How often the code is checked. */
const POLL_MS = 3000;
/** Jellyfin gives no expiry with the code, and says it expired by forgetting it
 * (the poll answers `expired`). This is only a stop for a page left open. */
const GIVE_UP_MS = 10 * 60_000;

/** Under the code: where to approve it. */
export const APPROVE_NOTE =
  "Open your Jellyfin in a browser or another app, then your user menu, Quick Connect, and type the code. This page notices on its own.";

const EXPIRED = "The code ran out. Try Quick Connect again for a new one.";

/** What a failed start says, without an address in it. */
export function startNote(e: unknown): string {
  const why = String(e instanceof Error ? e.message : e);
  if (why.startsWith("denied:")) return "Wrong user name or password.";
  if (why.startsWith("unsupported-build:"))
    return "Signing in to Jellyfin needs the latest BlammyTV. Update the app and try again.";
  if (why.startsWith("unsupported:")) {
    if (/AIOStreams/.test(why)) return "That is an AIOStreams address. Sign in to it under AIOStreams above.";
    if (/too old/i.test(why)) return "That Jellyfin is too old. BlammyTV needs Jellyfin 10.9 or later.";
    if (/Quick Connect/i.test(why)) return "Quick Connect is turned off on that server. Sign in with your password.";
    return "That address is not a Jellyfin server.";
  }
  // derive() refused it before any request went out (jf.rs).
  if (/not a server address/.test(why))
    return "That doesn't look like a server address. Use the one you open Jellyfin at, like jellyfin.example.com or 192.168.1.20:8096.";
  if (/cannot carry a user name/.test(why)) return "Leave the user name and password out of the address.";
  return `Jellyfin didn't answer: ${scrubbedMessage(why)}`;
}

/**
 * `onSignedIn` is told once the sign-in has landed and been recorded on this
 * device (account.ts `readSignIn`), with the status that read. Cancel,
 * unmounting, and a new attempt each move the attempt on, and an answer that
 * arrives after that stops there.
 */
export function useJfSignIn(onSignedIn: (status: JfStatus) => void) {
  const [phase, setPhase] = useState<JfSignInPhase>({ at: "idle" });
  const poll = useRef(0);
  const attempt = useRef({ n: 0 });
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    const sign = attempt.current;
    return () => {
      sign.n++;
      window.clearTimeout(poll.current);
    };
  }, []);

  const cancel = useCallback(() => {
    attempt.current.n++;
    window.clearTimeout(poll.current);
    setPhase({ at: "idle" });
  }, []);

  /** By user name and password. */
  const signInWithPassword = useCallback(async (address: string, user: string, password: string) => {
    const mine = ++attempt.current.n;
    window.clearTimeout(poll.current);
    setPhase({ at: "starting" });
    try {
      await jfSignIn(address.trim(), user.trim(), password);
    } catch (e) {
      if (mine !== attempt.current.n) return;
      return setPhase({ at: "idle", note: startNote(e) });
    }
    if (mine !== attempt.current.n) return;
    const s = await readSignIn();
    if (mine !== attempt.current.n) return;
    setPhase({ at: "idle" });
    signedIn.current(s);
  }, []);

  /** By Quick Connect. */
  const quickConnect = useCallback(async (address: string) => {
    const mine = ++attempt.current.n;
    window.clearTimeout(poll.current);
    setPhase({ at: "starting" });
    let code: JfQuickConnect;
    try {
      code = await jfQuickConnect(address.trim());
    } catch (e) {
      if (mine !== attempt.current.n) return;
      return setPhase({ at: "idle", note: startNote(e) });
    }
    if (mine !== attempt.current.n) return;
    setPhase({ at: "code", start: code });
    const deadline = Date.now() + GIVE_UP_MS;
    const tick = async () => {
      if (Date.now() > deadline) return setPhase({ at: "idle", note: EXPIRED });
      const r = await jfPoll().catch(() => "pending" as const);
      if (mine !== attempt.current.n) return;
      if (r === "approved") {
        const s = await readSignIn();
        if (mine !== attempt.current.n) return;
        setPhase({ at: "idle" });
        signedIn.current(s);
        return;
      }
      if (r === "expired") return setPhase({ at: "idle", note: EXPIRED });
      if (r === "error") return setPhase({ at: "idle", note: "Jellyfin didn't finish the sign-in. Try again." });
      poll.current = window.setTimeout(() => void tick(), POLL_MS);
    };
    poll.current = window.setTimeout(() => void tick(), POLL_MS);
  }, []);

  return { phase, signInWithPassword, quickConnect, cancel };
}
