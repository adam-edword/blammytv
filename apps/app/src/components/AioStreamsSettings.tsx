import { useState } from "react";
import { getAioUrl, setAioUrl } from "../lib/settings";

/** Settings → AIOStreams: paste the manifest URL that powers movies & shows.
 * Saving rebuilds the catalog (the config re-pulls). */
export function AioStreamsSettings({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState(getAioUrl());
  const dirty = url.trim() !== getAioUrl();

  const save = () => {
    setAioUrl(url);
    onSaved();
  };

  return (
    <section className="settings__section">
      <div className="settings__row settings__row--block">
        <span className="settings__row-title">AIOStreams manifest URL</span>
        <p className="settings__row-desc">
          Paste your AIOStreams manifest URL (the <code>…/manifest.json</code>{" "}
          link). This powers movies &amp; shows.
        </p>
        <input
          className="field__input aiostreams__input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/manifest.json"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="carousel-sources__actions">
          <button
            className="btn btn--primary"
            type="button"
            disabled={!dirty}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
