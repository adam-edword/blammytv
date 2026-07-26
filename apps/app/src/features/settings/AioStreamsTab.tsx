import { useId, useState } from "react";
import { CheckIcon, CloseIcon, CopyIcon } from "../../ui/icons";
import { probeAioStreams, probeVerdict, type ProbeStep } from "./aioProbe";
import { isValidManifestUrl, loadAioUrl, saveAioUrl } from "./aiostreams";

export function AioStreamsTab() {
  const [url, setUrl] = useState(loadAioUrl);
  const [savedUrl, setSavedUrl] = useState(url);
  const dirty = url.trim() !== savedUrl;
  const id = useId();

  // Connection test (the Bobby-403 debugging affordance) — runs the
  // app's real fetch paths and reports per-endpoint results, scrubbed.
  const [probe, setProbe] = useState<ProbeStep[] | null>(null);
  const [probing, setProbing] = useState(false);
  const runProbe = (target: string) => {
    setProbing(true);
    setProbe(null);
    probeAioStreams(target)
      .then(setProbe)
      .finally(() => setProbing(false));
  };

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
    if (next) runProbe(next);
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

  return (
    <>
      <section className="settings-section">
        <h3 className="settings__section-title">AIOStreams Manifest</h3>
        <p className="settings__section-note">
          Paste your AIOStreams manifest URL. It powers the movies and series
          under the Stream tab.
        </p>
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
                <button
                  type="button"
                  className="settings-field__tool"
                  aria-label="Copy manifest URL"
                  title={copied ? "Copied!" : "Copy"}
                  onClick={copy}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button
                  type="button"
                  className="settings-field__tool"
                  aria-label="Clear manifest URL"
                  title="Clear"
                  onClick={() => setUrl("")}
                >
                  <CloseIcon />
                </button>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || !submittable}
          onClick={submit}
        >
          {dirty || !savedUrl ? "Submit" : "Saved"}
        </button>
      </section>

      {savedUrl && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Connection Test</h3>
          <p className="settings__section-note settings__section-note--dim">
            Checks your instance the same way the app talks to it:
            manifest, a catalog page, and a stream lookup. Screenshot the
            result when reporting a problem; it never shows your URL.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={probing}
            onClick={() => runProbe(savedUrl)}
          >
            {probing ? "Testing…" : "Run Connection Test"}
          </button>
          {probe && (
            <>
              <ul className="aio-probe">
                {probe.map((s) => (
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
              {probeVerdict(probe) && (
                <p className="aio-probe__verdict">{probeVerdict(probe)}</p>
              )}
            </>
          )}
        </section>
      )}

    </>
  );
}
