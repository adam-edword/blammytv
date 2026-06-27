import { useState } from "react";
import { setAioUrl } from "../lib/settings";

/** First-run welcome for the standalone desktop app: capture the AIOStreams
 * manifest URL so the app can build its catalog. Everything else (IPTV
 * playlists, customization) is available later in Settings. */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");

  const submit = () => {
    if (!url.trim()) return;
    setAioUrl(url);
    onDone();
  };

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <img className="onboarding__logo" src="/logo.png" alt="" />
        <h1 className="onboarding__title">Welcome to BlammyTV</h1>
        <p className="onboarding__lede">
          Paste your AIOStreams manifest URL to get started. You can add IPTV
          playlists and tweak everything else in Settings later.
        </p>
        <input
          className="field__input onboarding__input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://…/manifest.json"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <button
          className="btn btn--primary onboarding__btn"
          type="button"
          disabled={!url.trim()}
          onClick={submit}
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
