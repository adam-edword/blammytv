import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { isTauri } from "../../lib/tauri";
import { AioCode } from "../aiojf/AioCode";
import { readSignIn, signOutOfJf } from "../jellyfin/account";
import type { JfStatus } from "../jellyfin/client";
import { PLAIN_NOTE, sendsPlain } from "../jellyfin/plain";
import { JF_CHANGED } from "../jellyfin/store";
import { APPROVE_NOTE, useJfSignIn } from "../jellyfin/useSignIn";

/**
 * Settings → Sources → Stream → Jellyfin: your own Jellyfin server (plan 027).
 *
 * A source of its own beside AIOStreams (D1), not a replacement for it: its
 * libraries become rows in Stream and Discover, and a title opened from one
 * plays your files. Sign in by user name and password, or by Quick Connect
 * (D2). Signed in, this shows who and where, and Disconnect, which also ends
 * the sign-in on the server. The password goes to the app once and is not
 * kept; the sign-in itself lives in Windows Credential Manager, and a settings
 * file never holds it.
 */

/** An address's origin: the host and port, never a path. */
function originOf(base: string | undefined): string {
  try {
    return base ? new URL(base).origin : "";
  } catch {
    return "";
  }
}

export function JellyfinTab() {
  const addressId = useId();
  const userId = useId();
  const passId = useId();
  // What the native side says about the sign-in. Null until it has answered;
  // a browser (no native side at all) is the build that cannot sign in.
  const [status, setStatus] = useState<JfStatus | null>(() =>
    isTauri() ? null : { supported: false, connected: false },
  );
  const [address, setAddress] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [armed, setArmed] = useState(false);
  const [signedOut, setSignedOut] = useState<string | null>(null);

  const flow = useJfSignIn((s) => {
    setStatus(s);
    setPassword("");
    setSignedOut(null);
  });

  const refresh = useCallback(async () => {
    setStatus(await readSignIn());
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void refresh();
    // A sign-out, or a 401 that signed this device out: read it again.
    const onChanged = () => void refresh();
    window.addEventListener(JF_CHANGED, onChanged);
    return () => window.removeEventListener(JF_CHANGED, onChanged);
  }, [refresh]);

  const starting = flow.phase.at === "starting";
  const note = flow.phase.at === "idle" ? flow.phase.note : undefined;
  const quick = flow.phase.at === "code" ? flow.phase.start : null;
  const [copied, setCopied] = useState(false);
  const copyCode = (code: string) =>
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});

  const canSubmit = !!address.trim() && !!user.trim() && !!password && !starting;
  const signIn = () => {
    if (!canSubmit) return;
    void flow.signInWithPassword(address, user, password);
  };

  const disconnect = () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    // The sign-out says so (JF_CHANGED), and the status is read again then.
    void signOutOfJf().then((revoked) =>
      setSignedOut(
        revoked
          ? null
          : "Signed out here, but the server could not be reached, so your sign-in still stands there. Remove this device from your Jellyfin dashboard, Devices.",
      ),
    );
  };

  if (!status) return null;
  // A browser, or a build from before the Jellyfin commands: nothing to offer
  // yet, and a line saying why only on the desktop app.
  if (!status.supported) {
    return isTauri() ? (
      <section className="settings-section" data-setting="jellyfin">
        <h3 className="settings-section__list-title">Jellyfin</h3>
        <p className="settings__section-note settings__section-note--dim">
          Signing in to your own Jellyfin server needs the latest BlammyTV. Update the app and it shows up here.
        </p>
      </section>
    ) : null;
  }

  const connected = status.connected;
  const origin = originOf(status.base);

  return (
    <section className="settings-section" data-setting="jellyfin">
      <h3 className="settings-section__list-title">Jellyfin</h3>
      {connected ? (
        <div className="customize-row aio-row">
          <div>
            <h4 className="customize-row__title">
              {status.userName ? `Signed in as ${status.userName}` : "Signed in"}
            </h4>
            {(status.serverName || origin) && (
              <p className="settings__section-note settings__section-note--dim">
                {[status.serverName, origin].filter(Boolean).join(" · ")}
                {status.version ? ` · Jellyfin ${status.version}` : ""}
              </p>
            )}
            <p className="settings__section-note settings__section-note--dim">
              Your movie and show libraries are rows in Stream and Discover. Tested on Jellyfin 12.x.
            </p>
            {sendsPlain(status.base) && (
              <p className="settings__section-note settings__section-note--dim" data-jf-plain>
                {PLAIN_NOTE}
              </p>
            )}
          </div>
          <div className="aio-row__actions">
            <Button
              variant={armed ? "destructive" : "outline"}
              type="button"
              className={armed ? "" : "hover:border-destructive hover:text-destructive"}
              onClick={disconnect}
            >
              {armed ? "Click again to confirm" : "Disconnect"}
            </Button>
          </div>
        </div>
      ) : quick ? (
        <div className="customize-row aio-row">
          <div>
            <h4 className="customize-row__title">Sign in to {quick.serverName || "Jellyfin"}</h4>
            <AioCode code={quick.code} copied={copied} onCopy={() => void copyCode(quick.code)} />
            <p className="settings__section-note settings__section-note--dim">{APPROVE_NOTE}</p>
          </div>
          <div className="aio-row__actions">
            <Button variant="secondary" type="button" onClick={flow.cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="settings__section-note">
            Sign in to your own Jellyfin server. Its movie and show libraries become rows under the Stream tab
            and in Discover, and a title you open from one plays your own files. Tested on Jellyfin 12.x.
          </p>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor={addressId}>
              Server address
            </label>
            <div className="settings-field__control">
              <input
                id={addressId}
                className="settings-input"
                type="text"
                value={address}
                placeholder="jellyfin.example.com or 192.168.1.20:8096"
                onChange={(e) => setAddress(e.target.value)}
                disabled={starting}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor={userId}>
              User name
            </label>
            <div className="settings-field__control">
              <input
                id={userId}
                className="settings-input"
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                disabled={starting}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor={passId}>
              Password
            </label>
            <div className="settings-field__control">
              <input
                id={passId}
                className="settings-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.repeat) signIn();
                }}
                disabled={starting}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
          {sendsPlain(address) && (
            <p className="settings__section-note settings__section-note--dim" data-jf-plain>
              {PLAIN_NOTE}
            </p>
          )}
          {note && (
            <p className="settings__section-note settings__section-note--dim" role="alert">
              {note}
            </p>
          )}
          {signedOut && (
            <p className="settings__section-note settings__section-note--dim" role="status">
              {signedOut}
            </p>
          )}
          <div className="aio-row__actions">
            <Button variant="default" type="button" disabled={!canSubmit} onClick={signIn}>
              {starting ? "Signing in…" : "Sign in"}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={!address.trim() || starting}
              onClick={() => void flow.quickConnect(address)}
            >
              Use Quick Connect
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
