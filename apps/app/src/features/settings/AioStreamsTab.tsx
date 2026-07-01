import { useState } from "react";
import { isValidManifestUrl, loadAioUrl, saveAioUrl } from "./aiostreams";

export function AioStreamsTab() {
  const [url, setUrl] = useState(loadAioUrl);
  const [savedUrl, setSavedUrl] = useState(url);
  const dirty = url.trim() !== savedUrl;

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
      <input
        className="settings-input"
        type="text"
        value={url}
        placeholder="https://…/manifest.json"
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
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
