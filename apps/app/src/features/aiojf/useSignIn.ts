import { useCallback, useEffect, useRef, useState } from "react";
import { scrubbedMessage } from "../../lib/errors";
import { openExternal } from "../../lib/tauri";
import { readSignIn } from "./account";
import { aiojfPoll, aiojfStart, type AiojfStatus, type QuickConnect } from "./client";

/**
 * Signing in to AIOStreams by Quick Connect (plan 023, B3, moved here for
 * plan 024): the one flow Settings → Sources → Stream and
 * onboarding's sign-in step both run, each in its own look.
 *
 * The app shows a 6-digit code, you approve it on your AIOStreams configure
 * page, and the app notices on its own. `start` takes the address as typed
 * (any form aiojf.rs `derive` reads, a pasted manifest or configure URL
 * included). The code and the polling live in the component that holds this
 * and stop with it; the token never comes near the page (aiojf.rs keeps it in
 * Windows Credential Manager).
 */
export type SignInPhase =
  | { at: "idle"; note?: string }
  /** The address is being checked and a code asked for. */
  | { at: "starting" }
  | { at: "code"; start: QuickConnect };

/** How often the code is checked. */
const POLL_MS = 3000;

/** Under the code: where to approve it. */
export const APPROVE_NOTE =
  "Approve it on your AIOStreams configure page: Save & Install, Jellyfin apps, Connect. Open AIOStreams copies the code for you. This page notices on its own.";

const EXPIRED = "The code ran out. Connect again for a new one.";

/** What a failed start says, without an address in it. */
function startNote(e: unknown): string {
  const why = String(e instanceof Error ? e.message : e);
  if (why.startsWith("unsupported:"))
    return "Your AIOStreams needs version 2.35 or later, with its Jellyfin side on. A manifest URL still works.";
  // derive() refused it before any request went out.
  if (/AIOStreams address/.test(why))
    return "That doesn't look like an AIOStreams address. Use the one your configure page lives at, like aiostreams.example.com.";
  return `AIOStreams didn't answer: ${scrubbedMessage(why)}`;
}

/**
 * `onSignedIn` is told once the approval has landed and the sign-in has been
 * recorded on this device (account.ts `readSignIn`), with the status that
 * read. Cancel, unmounting, and a new `start` each move the attempt on, and
 * a poll that answers after that stops there.
 */
export function useAioSignIn(onSignedIn: (status: AiojfStatus) => void) {
  const [phase, setPhase] = useState<SignInPhase>({ at: "idle" });
  // The code goes to AIOStreams' page by paste: typed off the screen, an 8
  // and a B are easy to mix up.
  const [copied, setCopied] = useState(false);
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

  const start = useCallback(async (address: string) => {
    const mine = ++attempt.current.n;
    window.clearTimeout(poll.current);
    setPhase({ at: "starting" });
    let code: QuickConnect;
    try {
      code = await aiojfStart(address.trim());
    } catch (e) {
      if (mine !== attempt.current.n) return;
      return setPhase({ at: "idle", note: startNote(e) });
    }
    if (mine !== attempt.current.n) return;
    setPhase({ at: "code", start: code });
    const deadline = Date.now() + code.expiresIn * 1000;
    const tick = async () => {
      if (Date.now() > deadline) return setPhase({ at: "idle", note: EXPIRED });
      const r = await aiojfPoll().catch(() => "pending" as const);
      if (mine !== attempt.current.n) return;
      if (r === "approved") {
        // Records the sign-in (and, with it, drops a stored manifest URL).
        const s = await readSignIn();
        if (mine !== attempt.current.n) return;
        setPhase({ at: "idle" });
        signedIn.current(s);
        return;
      }
      if (r === "expired") return setPhase({ at: "idle", note: EXPIRED });
      if (r === "error") return setPhase({ at: "idle", note: "AIOStreams didn't finish the sign-in. Connect again." });
      poll.current = window.setTimeout(() => void tick(), POLL_MS);
    };
    poll.current = window.setTimeout(() => void tick(), POLL_MS);
  }, []);

  const copyCode = useCallback(
    (code: string) =>
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        })
        .catch(() => {}),
    [],
  );

  /** Copies the code and opens the configure page, where it is approved. */
  const openAio = useCallback(() => {
    if (phase.at !== "code") return;
    void copyCode(phase.start.code);
    openExternal(phase.start.configureUrl);
  }, [phase, copyCode]);

  return { phase, copied, start, cancel, copyCode, openAio };
}
