import { useState } from "react";
import { getAioUrl, setAioUrl } from "../lib/settings";
import { FocusButton } from "./FocusButton";
import { FocusField } from "./FocusField";

/** Settings → AIOStreams: paste the manifest URL that powers movies & shows.
 * Saving rebuilds the catalog (the config re-pulls). */
export function AioStreamsSettings({
  onSaved,
  onReRunSetup,
}: {
  onSaved: () => void;
  /** Open the phone-handoff flow instead of typing the URL on the remote. */
  onReRunSetup?: () => void;
}) {
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
        {onReRunSetup && (
          <FocusButton
            className="btn settings__handoff-btn"
            focusKey="set-aio-handoff"
            onPress={onReRunSetup}
          >
            Set up from your phone
          </FocusButton>
        )}
        <FocusField
          label="Manifest URL"
          focusKey="set-aio-url"
          value={url}
          onChange={setUrl}
          type="url"
          inputMode="url"
          placeholder="https://…/manifest.json"
        />
        <div className="carousel-sources__actions">
          <FocusButton
            className="btn btn--primary"
            focusKey="set-aio-save"
            disabled={!dirty}
            onPress={save}
          >
            Save
          </FocusButton>
        </div>
      </div>
    </section>
  );
}
