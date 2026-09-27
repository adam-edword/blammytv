import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { isTauri, openExternal } from "../../lib/tauri";
import {
  traktDeviceStart,
  traktDevicePoll,
  traktJson,
  traktStatus,
  type DeviceCode,
} from "../trakt/client";
import { ago, signOutOfTrakt } from "../trakt/account";
import { loadTrakt, TRAKT_SYNCED } from "../trakt/store";
import { syncTrakt } from "../trakt/sync";

/**
 * Settings → General → Accounts: connect Trakt (plan 015, B2).
 *
 * Trakt's device sign-in: the app shows a short code, you enter it at
 * trakt.tv/activate on any device, and the app notices on its own. The code
 * and the polling live here and stop when Settings closes; the tokens never
 * come near the page (trakt.rs keeps them in Windows Credential Manager).
 */
type Phase =
  | { at: "loading" }
  | { at: "unconfigured" }
  | { at: "off"; note?: string }
  | { at: "code"; code: DeviceCode }
  | { at: "on" };

export function TraktSection() {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [user, setUser] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [, bump] = useState(0);
  const poll = useRef(0);

  const refresh = useCallback(async () => {
    const s = await traktStatus();
    if (!s.configured) return setPhase({ at: "unconfigured" });
    if (!s.connected) return setPhase((p) => (p.at === "code" ? p : { at: "off" }));
    setPhase({ at: "on" });
    const me = await traktJson<{ user?: { username?: string; name?: string } }>("GET", "/users/settings").catch(() => null);
    setUser(me?.data?.user?.name || me?.data?.user?.username || null);
  }, []);

  useEffect(() => {
    void refresh();
    const onSynced = () => bump((n) => n + 1);
    window.addEventListener(TRAKT_SYNCED, onSynced);
    return () => {
      window.removeEventListener(TRAKT_SYNCED, onSynced);
      window.clearTimeout(poll.current);
    };
  }, [refresh]);

  if (!isTauri() || phase.at === "loading") return null;

  const connect = async () => {
    let code: DeviceCode;
    try {
      code = await traktDeviceStart();
    } catch (e) {
      return setPhase({ at: "off", note: `Trakt didn't answer: ${e instanceof Error ? e.message : String(e)}` });
    }
    setPhase({ at: "code", code });
    let every = code.interval * 1000;
    const deadline = Date.now() + code.expires_in * 1000;
    const tick = async () => {
      if (Date.now() > deadline) return setPhase({ at: "off", note: "The code ran out. Connect again for a new one." });
      const r = await traktDevicePoll().catch(() => "pending" as const);
      if (r === "approved") {
        setPhase({ at: "on" });
        void refresh();
        setSyncing(true);
        void syncTrakt().finally(() => setSyncing(false));
        return;
      }
      if (r === "denied") return setPhase({ at: "off", note: "Trakt says you declined. Connect again if that was a slip." });
      if (r === "expired" || r === "invalid" || r === "used" || r === "idle")
        return setPhase({ at: "off", note: "The code ran out. Connect again for a new one." });
      // Polling too fast: Trakt asks for slower (the OAuth rule is +5s).
      if (r === "slow_down") every += 5000;
      poll.current = window.setTimeout(() => void tick(), every);
    };
    poll.current = window.setTimeout(() => void tick(), every);
  };

  const cancel = () => {
    window.clearTimeout(poll.current);
    setPhase({ at: "off" });
  };

  const syncNow = () => {
    setSyncing(true);
    void syncTrakt().finally(() => {
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
    void signOutOfTrakt().then(() => setPhase({ at: "off" }));
  };

  const local = loadTrakt();
  const note =
    phase.at === "unconfigured"
      ? "This build has no Trakt keys, so Trakt is off."
      : phase.at === "off"
        ? (phase.note ?? "Send what you watch to Trakt, and bring back what you watched elsewhere, where you left off, and your watchlist.")
        : phase.at === "code"
          ? `Go to ${phase.code.verification_url.replace(/^https?:\/\//, "")} on any device and enter the code. This page notices on its own.`
          : local.problem && local.problem !== "not connected"
            ? `Last sync hit a snag: ${local.problem}`
            : local.capped
              ? `${local.capped.count} ${local.capped.count === 1 ? "title" : "titles"} didn't fit on your Trakt watchlist${local.capped.limit ? ` (a free account holds ${local.capped.limit})` : ""}. They stay here.`
              : local.lastSync
                ? `Synced ${ago(local.lastSync)}.`
                : "Syncing for the first time.";

  return (
    <div className="customize-row trakt-row">
      <div>
        <h4 className="customize-row__title">
          {phase.at === "on" ? (user ? `Trakt: ${user}` : "Trakt: connected") : "Trakt"}
        </h4>
        {phase.at === "code" && (
          <p className="trakt-row__code" aria-label={`Code ${phase.code.user_code}`}>
            {phase.code.user_code}
          </p>
        )}
        <p className="settings__section-note settings__section-note--dim">{note}</p>
      </div>
      {phase.at === "off" && (
        <Button variant="secondary" type="button" onClick={() => void connect()}>
          Connect
        </Button>
      )}
      {phase.at === "code" && (
        <div className="trakt-row__actions">
          <Button variant="default" type="button" onClick={() => openExternal(phase.code.verification_url)}>
            Open Trakt
          </Button>
          <Button variant="secondary" type="button" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
      {phase.at === "on" && (
        <div className="trakt-row__actions">
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
