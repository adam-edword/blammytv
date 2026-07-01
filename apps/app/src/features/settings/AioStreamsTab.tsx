import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronIcon, CloseIcon } from "../../ui/icons";
import { fetchAioCatalogs, type AioCatalog } from "../../data/aiostreams";
import {
  isValidManifestUrl,
  loadAioUrl,
  loadHeroSources,
  saveAioUrl,
  saveHeroSources,
} from "./aiostreams";

type Catalogs =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: AioCatalog[] }
  | { status: "error" };

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

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

  // Hero-slider sources: an explicit selection of catalogs from the saved
  // manifest, shown as removable chips. Empty = the default mix.
  const [catalogs, setCatalogs] = useState<Catalogs>({ status: "idle" });
  const [selected, setSelected] = useState<string[]>(loadHeroSources);

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

  const update = (keys: string[]) => {
    setSelected(keys);
    saveHeroSources(keys);
  };

  // The "add sources" dropdown. It renders in a portal with fixed
  // positioning so it can float outside the settings card (which clips its
  // own overflow); anchored to the button, flipped upward when the space
  // below runs out.
  const [addOpen, setAddOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    up: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!addOpen) return;
    const place = () => {
      const rect = addRef.current?.getBoundingClientRect();
      if (!rect) return;
      // The UI-scale zoom on <html> scales layout units; rects come back in
      // visual pixels, so divide to keep the fixed menu aligned.
      const zoom = Number(document.documentElement.style.zoom || 1) || 1;
      const spaceBelow = window.innerHeight - rect.bottom;
      const up = spaceBelow < 300 && rect.top > spaceBelow;
      setMenuPos({
        top: (up ? rect.top - 8 : rect.bottom + 8) / zoom,
        left: rect.left / zoom,
        up,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
    // catalogs.status: the anchor button mounts with the catalog list, so
    // re-place once it exists.
  }, [addOpen, catalogs.status]);

  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAddOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !addRef.current?.contains(t)) {
        setAddOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("mousedown", onDown);
    };
  }, [addOpen]);

  const items = catalogs.status === "ready" ? catalogs.items : [];
  const byKey = new Map(items.map((c) => [c.key, c]));
  const available = items.filter((c) => !selected.includes(c.key));

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
            The catalogs the hero pulls from, spread evenly and shuffled on
            each load. Leave empty for the default mix of everything.
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
          {catalogs.status === "ready" && (
            <div className="chip-select">
              {selected.map((key) => {
                const c = byKey.get(key);
                return (
                  <span key={key} className="source-chip">
                    {c ? `${c.name} · ${typeLabel(c.type)}` : key}
                    <button
                      type="button"
                      className="source-chip__x"
                      aria-label={`Remove ${c?.name ?? key}`}
                      onClick={() =>
                        update(selected.filter((k) => k !== key))
                      }
                    >
                      <CloseIcon />
                    </button>
                  </span>
                );
              })}
              {available.length > 0 && (
                <>
                  <button
                    type="button"
                    ref={addRef}
                    className="chip-select__add"
                    aria-expanded={addOpen}
                    onClick={() => setAddOpen((o) => !o)}
                  >
                    add sources
                    <ChevronIcon />
                  </button>
                  {addOpen &&
                    menuPos &&
                    createPortal(
                      <div
                        className="chip-select__menu"
                        ref={menuRef}
                        style={{
                          top: menuPos.top,
                          left: menuPos.left,
                          transform: menuPos.up
                            ? "translateY(-100%)"
                            : undefined,
                        }}
                      >
                        {available.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            className="chip-select__option"
                            onClick={() => update([...selected, c.key])}
                          >
                            {c.name}
                            <span className="source-row__type">
                              {typeLabel(c.type)}
                            </span>
                          </button>
                        ))}
                      </div>,
                      document.body,
                    )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
