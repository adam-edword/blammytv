import { useId, useState } from "react";
import { isValidManifestUrl, loadAioUrl, saveAioUrl } from "./aiostreams";

export function AioStreamsTab() {
  const [url, setUrl] = useState(loadAioUrl);
  const [savedUrl, setSavedUrl] = useState(url);
  const dirty = url.trim() !== savedUrl;
  const id = useId();

  const submit = () => {
    if (!isValidManifestUrl(url)) return;
    saveAioUrl(url);
    setSavedUrl(url.trim());
  };

  return (
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
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!dirty || !isValidManifestUrl(url)}
        onClick={submit}
      >
        {dirty || !savedUrl ? "Submit" : "Saved"}
      </button>
    </section>
  );
}
