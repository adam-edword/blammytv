import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { scrubbedMessage } from "../../lib/errors";
import { isTauri, openExternal } from "../../lib/tauri";
import { CheckIcon, CopyIcon } from "../../ui/icons";
import { Hint } from "../../ui/Hint";
import { readSignIn, signOutOfAio } from "../aiojf/account";
import { aiojfPoll, aiojfStart, type QuickConnect } from "../aiojf/client";
import { AIOJF_SYNCED, loadAiojf } from "../aiojf/store";
import { syncAiojf } from "../aiojf/sync";
import { ago } from "../trakt/account";
import { AIO_URL_CHANGED, loadAioUrl } from "./aiostreams";

/**
 * Settings → General → Accounts: AIOStreams sync (plan 023, B3).
 *
 * Every AIOStreams config is also a Jellyfin-compatible server, and signs an
 * app in by Quick Connect: the app shows a 6-digit code, you approve it on
 * your AIOStreams configure page, and the app notices on its own. The code
 * and the polling live here and stop when Settings closes; the token never
 * comes near the page (aiojf.rs keeps it in Windows Credential Manager).
 * Only shown once there is an AIOStreams URL, since the token belongs to the
 * config that URL names.
 */
type Phase =
  | { at: "loading" }
  /** The app's native side is older than this page. */
  | { at: "update" }
  | { at: "off"; note?: string }
  | { at: "code"; start: QuickConnect }
  | { at: "on" };

/** How often the row asks whether the code was approved. */
const POLL_MS = 3000;

export function AioSyncSection() {
  const [url, setUrl] = useState(loadAioUrl);
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [user, setUser] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [armed, setArmed] = useState(false);
  // The code goes to AIOStreams' page by paste: typed off the screen, an 8
  // and a B are easy to mix up.
  const [copied, setCopied] = useState(false);
  const [, bump] = useState(0);
  const poll = useRef(0);
  /** The sign-in under way, as Trakt's row keeps it: Cancel, closing Settings,
   * a new Connect and a changed URL each move it on, and a poll that answers
   * after that stops there. */
  const attempt = useRef({ n: 0 });

  const refresh = useCallback(async () => {
    // Also records the sign-in Stream reads AIOStreams by (plan 024).
    const s = await readSignIn();
    if (!s.supported) return setPhase({ at: "update" });
    setUser(s.connected ? (s.userName ?? null) : null);
    if (!s.connected) return setPhase((p) => (p.at === "code" ? p : { at: "off" }));
    setPhase({ at: "on" });
  }, []);

  useEffect(() => {
    void refresh();
    const sign = attempt.current;
    // A sync landed, or a 401 signed this device out: read it again.
    const onSynced = () => {
      bump((n) => n + 1);
      void refresh();
    };
    // A new URL is another account: a code under way was for the old one.
    const onUrl = () => {
      sign.n++;
      window.clearTimeout(poll.current);
      setUrl(loadAioUrl());
      setPhase((p) => (p.at === "code" ? { at: "off" } : p));
      void refresh();
    };
    window.addEventListener(AIOJF_SYNCED, onSynced);
    window.addEventListener(AIO_URL_CHANGED, onUrl);
    return () => {
      window.removeEventListener(AIOJF_SYNCED, onSynced);
      window.removeEventListener(AIO_URL_CHANGED, onUrl);
      sign.n++;
      window.clearTimeout(poll.current);
    };
  }, [refresh]);

  if (!isTauri() || !url || phase.at === "loading") return null;

  const connect = async () => {
    const mine = ++attempt.current.n;
    let start: QuickConnect;
    try {
      start = await aiojfStart(url);
    } catch (e) {
      if (mine !== attempt.current.n) return;
      const why = String(e instanceof Error ? e.message : e);
      return setPhase({
        at: "off",
        note: why.startsWith("unsupported:")
          ? "Your AIOStreams needs version 2.35 or later, with its Jellyfin side on."
          : `AIOStreams didn't answer: ${scrubbedMessage(why)}`,
      });
    }
    if (mine !== attempt.current.n) return;
    setPhase({ at: "code", start });
    const deadline = Date.now() + start.expiresIn * 1000;
    const tick = async () => {
      if (Date.now() > deadline) return setPhase({ at: "off", note: "The code ran out. Connect again for a new one." });
      const r = await aiojfPoll().catch(() => "pending" as const);
      if (mine !== attempt.current.n) return;
      if (r === "approved") {
        void refresh();
        setSyncing(true);
        void syncAiojf().finally(() => setSyncing(false));
        return;
      }
      if (r === "expired") return setPhase({ at: "off", note: "The code ran out. Connect again for a new one." });
      if (r === "error") return setPhase({ at: "off", note: "AIOStreams didn't finish the sign-in. Connect again." });
      poll.current = window.setTimeout(() => void tick(), POLL_MS);
    };
    poll.current = window.setTimeout(() => void tick(), POLL_MS);
  };

  const copyCode = (code: string) =>
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});

  const cancel = () => {
    attempt.current.n++;
    window.clearTimeout(poll.current);
    setPhase({ at: "off" });
  };

  const syncNow = () => {
    setSyncing(true);
    void syncAiojf().finally(() => {
      setSyncing(false);
      bump((n) => n + 1);
    });
  };

  const disconnect = () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    setUser(null);
    void signOutOfAio().then(() => setPhase({ at: "off" }));
  };

  const local = loadAiojf();
  const note =
    phase.at === "update"
      ? "Sync needs the latest BlammyTV. Update the app and it shows up here."
      : phase.at === "off"
        ? (phase.note ?? "Show what you watch in your other AIOStreams apps, and bring back what you watched there, where you left off, and what's next.")
        : phase.at === "code"
          ? "Approve it on your AIOStreams configure page: Save & Install, Jellyfin apps, Connect. Open AIOStreams copies the code for you. This page notices on its own."
          : local.problem
            ? `Last sync hit a snag: ${local.problem}`
            : local.lastSync
              ? `Synced ${ago(local.lastSync)}.`
              : "Syncing for the first time.";

  return (
    <div className="customize-row aio-row">
      <div>
        <h4 className="customize-row__title">
          {phase.at === "on" ? (user ? `AIOStreams sync: ${user}` : "AIOStreams sync: connected") : "AIOStreams sync"}
        </h4>
        {phase.at === "code" && (
          <div className="trakt-row__codeline">
            <p className="trakt-row__code" aria-label={`Code ${phase.start.code}`}>
              {phase.start.code}
            </p>
            <Hint label={copied ? "Copied!" : "Copy code"}>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Copy code"
                onClick={() => void copyCode(phase.start.code)}
              >
                {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              </Button>
            </Hint>
          </div>
        )}
        <p className="settings__section-note settings__section-note--dim">{note}</p>
        {(phase.at === "off" || phase.at === "on") && (
          <p className="settings__section-note settings__section-note--dim">
            Leave any Trakt tracker out of your AIOStreams setup, or each play counts twice.
          </p>
        )}
      </div>
      {phase.at === "off" && (
        <Button variant="secondary" type="button" onClick={() => void connect()}>
          Connect
        </Button>
      )}
      {phase.at === "code" && (
        <div className="aio-row__actions">
          <Button
            variant="default"
            type="button"
            onClick={() => {
              void copyCode(phase.start.code);
              openExternal(phase.start.configureUrl);
            }}
          >
            Open AIOStreams
          </Button>
          <Button variant="secondary" type="button" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
      {phase.at === "on" && (
        <div className="aio-row__actions">
          <Button variant="secondary" type="button" disabled={syncing} onClick={syncNow}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            variant={armed ? "destructive" : "outline"}
            type="button"
            className={armed ? "" : "hover:border-destructive hover:text-destructive"}
            onClick={disconnect}
          >
            {armed ? "Click again to confirm" : "Disconnect"}
          </Button>
        </div>
      )}
    </div>
  );
}
