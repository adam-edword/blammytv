import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { isTauri } from "../../lib/tauri";
import { CheckIcon, CloseIcon, CopyIcon } from "../../ui/icons";
import { readSignIn, signOutOfAio } from "../aiojf/account";
import { AioCode } from "../aiojf/AioCode";
import { aiojfCanSource, type AiojfStatus } from "../aiojf/client";
import { loadAioConn } from "../aiojf/conn";
import { AIOJF_SYNCED, loadAiojf } from "../aiojf/store";
import { syncAiojf } from "../aiojf/sync";
import { APPROVE_NOTE, useAioSignIn } from "../aiojf/useSignIn";
import { ago } from "../trakt/account";
import { probeAioConn, probeAioStreams, probeVerdict, type ProbeStep } from "./aioProbe";
import { AIO_URL_CHANGED, isValidManifestUrl, loadAioUrl, saveAioUrl } from "./aiostreams";
import { Hint } from "../../ui/Hint";

/**
 * Settings → Sources → Stream: how the app reaches AIOStreams.
 *
 * Signing in leads (plan 024): your instance's address and a code you approve
 * on its configure page, the way plan 023's sync always did. Signed in, this
 * shows who and where, when it last synced, and Disconnect. The manifest URL
 * is the way in for an instance with its Jellyfin side off (D1), behind "Use
 * a manifest URL instead" while there is no sign-in, and offered straight
 * away on a build that cannot sign in (or cannot open sources by it).
 */

/** An address's origin: the host and port, never a path (the base carries the
 * config's prefix). */
function originOf(base: string | undefined): string {
  try {
    return base ? new URL(base).origin : "";
  } catch {
    return "";
  }
}

export function AioStreamsTab() {
  const [url, setUrl] = useState(loadAioUrl);
  const [savedUrl, setSavedUrl] = useState(url);
  const dirty = url.trim() !== savedUrl;
  const id = useId();
  const addressId = useId();

  // What the native side says about the sign-in. Null until it has answered;
  // a browser (no native side at all) is the build that cannot sign in.
  const [status, setStatus] = useState<AiojfStatus | null>(() =>
    isTauri() ? null : { supported: false, connected: false },
  );
  // Whether this native build can open sources by sign-in (client.ts
  // `aiojfCanSource`). A build from before plan 024 has the sync but its
  // `aiojf_start` refuses a plain address, so a new sign-in is not offered on
  // it, as onboarding does. Null until it has answered.
  const [canSource, setCanSource] = useState<boolean | null>(() => (isTauri() ? null : false));
  const [address, setAddress] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [, bump] = useState(0);

  const startSync = () => {
    setSyncing(true);
    void syncAiojf().finally(() => {
      setSyncing(false);
      bump((n) => n + 1);
    });
  };

  // Connection test (the Bobby-403 debugging affordance) — runs the
  // app's real fetch paths and reports per-endpoint results, scrubbed.
  // `key` names the connection the rows are for, so a test of the manifest
  // is not left standing under a sign-in.
  const [probe, setProbe] = useState<{ key: string; steps: ProbeStep[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const runProbe = (key: string, run: Promise<ProbeStep[]>) => {
    setProbing(true);
    setProbe(null);
    run.then((steps) => setProbe({ key, steps })).finally(() => setProbing(false));
  };

  const flow = useAioSignIn((s) => {
    setStatus(s);
    setProbe(null);
    if (s.connected) startSync();
  });

  const refresh = useCallback(async () => {
    setStatus(await readSignIn());
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    void aiojfCanSource().then((ok) => live && setCanSource(ok));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (isTauri()) void refresh();
    // A sync landed, or a 401 signed this device out: read it again.
    const onSynced = () => {
      bump((n) => n + 1);
      if (isTauri()) void refresh();
    };
    // The manifest is gone once a sign-in is recorded (store.ts), and the
    // field must not hold what is no longer stored.
    const onUrl = () => {
      const stored = loadAioUrl();
      setUrl(stored);
      setSavedUrl(stored);
    };
    window.addEventListener(AIOJF_SYNCED, onSynced);
    window.addEventListener(AIO_URL_CHANGED, onUrl);
    return () => {
      window.removeEventListener(AIOJF_SYNCED, onSynced);
      window.removeEventListener(AIO_URL_CHANGED, onUrl);
    };
  }, [refresh]);

  // Submitting an emptied field removes the saved manifest (that's what
  // makes the in-field clear meaningful).
  const submittable = url.trim() === "" || isValidManifestUrl(url);
  const submit = () => {
    if (!submittable) return;
    saveAioUrl(url);
    const next = url.trim();
    setSavedUrl(next);
    // A bad instance should be caught HERE, at setup, not on the first
    // Discover visit — auto-run the Connection Test on every new URL.
    if (next) runProbe(`manifest:${next}`, probeAioStreams(next));
    else setProbe(null);
  };

  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(url.trim())
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  const connect = () => {
    if (!address.trim() || flow.phase.at === "starting") return;
    void flow.start(address);
  };

  const disconnect = () => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    // The sign-out says so (AIOJF_SYNCED), and the status is read again then.
    void signOutOfAio();
  };

  if (!status || canSource === null) return null;

  const connected = status.supported && status.connected;
  // A sign-in this device holds always shows (Sync now, Disconnect); a new one
  // is offered only where the build can use it.
  const signInOffered = connected || (status.supported && canSource);
  // Stream browses by the sign-in only on a build that can open sources
  // (conn.ts); a connected one that cannot still syncs.
  const browses = connected && !!loadAiojf().signedIn;
  const showManifest = !signInOffered || (connected ? !browses : revealed || savedUrl !== "");
  const conn = loadAioConn();
  const local = loadAiojf();
  const origin = originOf(status.base);

  const syncLine = local.problem
    ? `Last sync hit a snag: ${local.problem}`
    : local.lastSync
      ? `Synced ${ago(local.lastSync)}.`
      : "Syncing for the first time.";
  const starting = flow.phase.at === "starting";
  const note = flow.phase.at === "idle" ? flow.phase.note : undefined;
  const quick = flow.phase.at === "code" ? flow.phase.start : null;
  const steps = probe && conn && probe.key === conn.key ? probe.steps : null;

  return (
    <>
      {signInOffered && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">AIOStreams</h3>
          {connected ? (
            <div className="customize-row aio-row">
              <div>
                <h4 className="customize-row__title">
                  {status.userName ? `Signed in as ${status.userName}` : "Signed in"}
                </h4>
                {origin && <p className="settings__section-note settings__section-note--dim">{origin}</p>}
                <p className="settings__section-note settings__section-note--dim">{syncLine}</p>
                {!browses && (
                  <p className="settings__section-note settings__section-note--dim">
                    Update BlammyTV to browse with your sign-in.
                  </p>
                )}
                <p className="settings__section-note settings__section-note--dim">
                  Leave any Trakt tracker out of your AIOStreams setup, or each play counts twice.
                </p>
              </div>
              <div className="aio-row__actions">
                <Button variant="secondary" type="button" disabled={syncing} onClick={startSync}>
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
            </div>
          ) : quick ? (
            <div className="customize-row aio-row">
              <div>
                <h4 className="customize-row__title">Sign in to AIOStreams</h4>
                <AioCode code={quick.code} copied={flow.copied} onCopy={() => void flow.copyCode(quick.code)} />
                <p className="settings__section-note settings__section-note--dim">{APPROVE_NOTE}</p>
              </div>
              <div className="aio-row__actions">
                <Button variant="default" type="button" onClick={flow.openAio}>
                  Open AIOStreams
                </Button>
                <Button variant="secondary" type="button" onClick={flow.cancel}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="settings__section-note">
                Sign in with your AIOStreams address. It powers the movies and series under the Stream tab,
                and syncs what you watch with your other AIOStreams apps.
              </p>
              <div className="settings-field">
                <label className="settings-field__label" htmlFor={addressId}>
                  AIOStreams address
                </label>
                <div className="settings-field__control">
                  <input
                    id={addressId}
                    className="settings-input"
                    type="text"
                    value={address}
                    placeholder="aiostreams.example.com"
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.repeat) connect();
                    }}
                    disabled={starting}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </div>
              {note && (
                <p className="settings__section-note settings__section-note--dim" role="alert">
                  {note}
                </p>
              )}
              <Button variant="default" type="button" disabled={!address.trim() || starting} onClick={connect}>
                {starting ? "Connecting…" : "Connect"}
              </Button>
              {!showManifest && (
                <Button
                  variant="link"
                  size="sm"
                  type="button"
                  className="h-auto p-0 text-muted-foreground"
                  onClick={() => setRevealed(true)}
                >
                  Use a manifest URL instead
                </Button>
              )}
            </>
          )}
        </section>
      )}

      {showManifest && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">AIOStreams Manifest</h3>
          <p className="settings__section-note">
            Paste your AIOStreams manifest URL. It powers the movies and series
            under the Stream tab.
          </p>
          {isTauri() && !signInOffered && (
            <p className="settings__section-note settings__section-note--dim">
              Signing in with your AIOStreams address needs the latest BlammyTV. Update the app and it shows up here.
            </p>
          )}
          <div className="settings-field">
            <label className="settings-field__label" htmlFor={id}>
              Manifest URL
            </label>
            <div className="settings-field__control">
              <input
                id={id}
                className="settings-input"
                type="text"
                value={url}
                placeholder="https://aiostreams.example.com/stremio/…/manifest.json"
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              {url.trim() !== "" && (
                <span className="settings-field__tools">
                  <Hint label={copied ? "Copied!" : "Copy"}>
                  <Button variant="ghost" size="icon-sm"
                    type="button"
                    className="settings-field__tool"
                    aria-label="Copy manifest URL"
                    onClick={copy}
                  >
                    {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  </Button>
                  </Hint>
                  <Hint label="Clear">
                  <Button variant="ghost" size="icon-sm"
                    type="button"
                    className="settings-field__tool"
                    aria-label="Clear manifest URL"
                    onClick={() => setUrl("")}
                  >
                    <CloseIcon className="size-3.5" />
                  </Button>
                  </Hint>
                </span>
              )}
            </div>
          </div>
          <Button
            variant="default"
            type="button"
            disabled={!dirty || !submittable}
            onClick={submit}
          >
            {dirty || !savedUrl ? "Submit" : "Saved"}
          </Button>
        </section>
      )}

      {conn && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Connection Test</h3>
          <p className="settings__section-note settings__section-note--dim">
            {conn.kind === "signin"
              ? "Checks your sign-in the way the app uses it: your catalogs, and a stream lookup for a known test title. Screenshot the result when reporting a problem; it never shows your address."
              : "Checks your instance the same way the app talks to it: manifest, a catalog page, and a stream lookup. Screenshot the result when reporting a problem; it never shows your URL."}
          </p>
          <Button
            variant="secondary"
            type="button"
            disabled={probing}
            onClick={() => runProbe(conn.key, probeAioConn(conn))}
          >
            {probing ? "Testing…" : "Run Connection Test"}
          </Button>
          {steps && (
            <>
              <ul className="aio-probe">
                {steps.map((s) => (
                  <li
                    key={s.label}
                    className={"aio-probe__row" + (s.ok ? "" : " aio-probe__row--bad")}
                  >
                    <span className="aio-probe__mark">{s.ok ? "✓" : "✗"}</span>
                    <span className="aio-probe__label">{s.label}</span>
                    <span className="aio-probe__detail">
                      {s.detail}
                      {s.forensic && (
                        <span className="aio-probe__forensic">{s.forensic}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {probeVerdict(steps) && (
                <p className="aio-probe__verdict">{probeVerdict(steps)}</p>
              )}
            </>
          )}
        </section>
      )}

    </>
  );
}
