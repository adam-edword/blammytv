import { useEffect, useId, useState } from "react";
import { Toggle } from "../../ui/Toggle";
import { fetchAioCatalogs, type AioCatalog } from "../../data/aiostreams";
import {
  isValidManifestUrl,
  loadAioUrl,
  loadHeroExcluded,
  saveAioUrl,
  saveHeroExcluded,
  toggleExcluded,
} from "./aiostreams";

type Catalogs =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: AioCatalog[] }
  | { status: "error" };

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

  // Hero-slider sources: catalogs come from the saved manifest; the user
  // switches individual ones off (stored as an excluded list).
  const [catalogs, setCatalogs] = useState<Catalogs>({ status: "idle" });
  const [excluded, setExcluded] = useState<string[]>(loadHeroExcluded);

  useEffect(() => {
    if (!isValidManifestUrl(savedUrl)) {
      setCatalogs({ status: "idle" });
      return;
    }
    let alive = true;
    setCatalogs({ status: "loading" });
    fetchAioCatalogs(savedUrl)
      .then((items) => {
        if (alive) setCatalogs({ status: "ready", items });
      })
      .catch(() => {
        if (alive) setCatalogs({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [savedUrl]);

  const flip = (key: string) => {
    const next = toggleExcluded(excluded, key);
    setExcluded(next);
    saveHeroExcluded(next);
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

      {savedUrl && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Hero Slider Sources</h3>
          <p className="settings__section-note settings__section-note--dim">
            The catalogs the Stream tab's hero pulls from. Everything is on by
            default; switch off what you don't want featured.
          </p>
          {catalogs.status === "loading" && (
            <p className="settings__section-note settings__section-note--dim">
              Loading catalogs…
            </p>
          )}
          {catalogs.status === "error" && (
            <p className="settings__section-note settings__section-note--dim">
              Couldn't reach the manifest. Check the URL — and note the
              browser dev build can be blocked by CORS where the desktop app
              isn't.
            </p>
          )}
          {catalogs.status === "ready" &&
            (catalogs.items.length === 0 ? (
              <p className="settings__section-note settings__section-note--dim">
                This manifest exposes no catalogs.
              </p>
            ) : (
              <div className="source-list">
                {catalogs.items.map((c) => (
                  <div key={c.key} className="source-row">
                    <span className="source-row__name">
                      {c.name}
                      <span className="source-row__type">{c.type}</span>
                    </span>
                    <Toggle
                      small
                      on={!excluded.includes(c.key)}
                      onChange={() => flip(c.key)}
                      label={`Feature ${c.name} in the hero`}
                    />
                  </div>
                ))}
              </div>
            ))}
        </section>
      )}
    </>
  );
}
