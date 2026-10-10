import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { isTauri, openExternal } from "../../lib/tauri";
import { signOutOfMal } from "../mal/account";
import { malJson, malSignInCancel, malSignInPoll, malSignInStart, malStatus } from "../mal/client";
import { loadMal, MAL_SYNCED } from "../mal/store";
import { syncMal } from "../mal/sync";
import { ago } from "../trakt/account";

/**
 * Settings → Accounts: connect MyAnimeList (plan 021, B5).
 *
 * MAL signs in in the browser: Connect opens MAL's page, and once you
 * approve, MAL sends the browser back to BlammyTV on localhost (mal.rs
 * listens for that one redirect). This row polls until it lands, and stops
 * when Settings closes. The tokens never come near the page.
 */
type Phase =
  | { at: "loading" }
  | { at: "unconfigured" }
  | { at: "off"; note?: string }
  | { at: "waiting"; url: string }
  | { at: "on" };

/** How often the row asks whether the browser came back. */
const POLL_MS = 1500;

export function MalSection() {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [user, setUser] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [, bump] = useState(0);
  const poll = useRef(0);
  /** The sign-in under way, as Trakt's row keeps it. `poll` alone could
   * not say: it is 0 while a poll is out, so closing Settings then neither
   * stopped the next one nor gave the sign-in's port back. */
  const attempt = useRef({ n: 0 });
  const waiting = useRef(false);

  const refresh = useCallback(async () => {
    const s = await malStatus();
    if (!s.configured) return setPhase({ at: "unconfigured" });
    if (!s.connected) return setPhase((p) => (p.at === "waiting" ? p : { at: "off" }));
    setPhase({ at: "on" });
    const me = await malJson<{ name?: string }>("GET", "/users/@me").catch(() => null);
    setUser(me?.data?.name || null);
  }, []);

  useEffect(() => {
    void refresh();
    const onSynced = () => bump((n) => n + 1);
    window.addEventListener(MAL_SYNCED, onSynced);
    const sign = attempt.current;
    return () => {
      window.removeEventListener(MAL_SYNCED, onSynced);
      // Settings closed mid sign-in: stop waiting and give the port back.
      sign.n++;
      if (waiting.current) void malSignInCancel().catch(() => {});
      waiting.current = false;
      window.clearTimeout(poll.current);
    };
  }, [refresh]);

  if (!isTauri() || phase.at === "loading") return null;

  const connect = async () => {
    const mine = ++attempt.current.n;
    let url: string;
    try {
      url = await malSignInStart();
    } catch (e) {
      if (mine !== attempt.current.n) return;
      return setPhase({ at: "off", note: `Couldn't start the sign-in: ${e instanceof Error ? e.message : String(e)}.` });
    }
    if (mine !== attempt.current.n) {
      // Gone while it started: nothing will poll it, so free the port now.
      void malSignInCancel().catch(() => {});
      return;
    }
    waiting.current = true;
    openExternal(url);
    setPhase({ at: "waiting", url });
    const tick = async () => {
      poll.current = 0;
      const s = await malSignInPoll().catch(() => ({ at: "waiting" }) as const);
      if (mine !== attempt.current.n) return;
      if (s.at !== "waiting") waiting.current = false;
      if (s.at === "waiting") {
        poll.current = window.setTimeout(() => void tick(), POLL_MS);
        return;
      }
      if (s.at === "approved") {
        setPhase({ at: "on" });
        void refresh();
        setSyncing(true);
        void syncMal().finally(() => setSyncing(false));
        return;
      }
      setPhase({
        at: "off",
        note:
          s.at === "denied"
            ? "MyAnimeList says you declined. Connect again if that was a slip."
            : s.at === "expired"
              ? "The sign-in timed out. Connect again to start over."
              : s.at === "failed"
                ? `MyAnimeList didn't finish the sign-in (${s.note}). Connect again.`
                : undefined,
      });
    };
    poll.current = window.setTimeout(() => void tick(), POLL_MS);
  };

  const cancel = () => {
    attempt.current.n++;
    waiting.current = false;
    window.clearTimeout(poll.current);
    poll.current = 0;
    void malSignInCancel().catch(() => {});
    setPhase({ at: "off" });
  };

  const syncNow = () => {
    setSyncing(true);
    void syncMal().finally(() => {
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
    void signOutOfMal().then(() => setPhase({ at: "off" }));
  };

  const local = loadMal();
  const note =
    phase.at === "unconfigured"
      ? "This build has no MyAnimeList key, so MyAnimeList is off."
      : phase.at === "off"
        ? (phase.note ?? "Send the anime episodes you finish to your MyAnimeList, and tick the ones it says you've seen.")
        : phase.at === "waiting"
          ? "Approve BlammyTV on MyAnimeList in your browser. This page notices on its own."
          : local.problem
            ? `Last sync hit a snag: ${local.problem}.`
            : local.lastSync
              ? `Synced ${ago(local.lastSync)}.`
              : "Syncing for the first time.";

  return (
    <div className="customize-row mal-row" data-setting="mal">
      <div>
        <h4 className="customize-row__title">
          {phase.at === "on" ? (user ? `MyAnimeList: ${user}` : "MyAnimeList: connected") : "MyAnimeList"}
        </h4>
        <p className="settings__section-note settings__section-note--dim">{note}</p>
      </div>
      {phase.at === "off" && (
        <Button variant="secondary" type="button" onClick={() => void connect()}>
          Connect
        </Button>
      )}
      {phase.at === "waiting" && (
        <div className="mal-row__actions">
          <Button variant="default" type="button" onClick={() => openExternal(phase.url)}>
            Open MyAnimeList
          </Button>
          <Button variant="secondary" type="button" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
      {phase.at === "on" && (
        <div className="mal-row__actions">
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
