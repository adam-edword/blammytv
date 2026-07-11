import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronIcon, CloseIcon, CopyIcon } from "../../ui/icons";
import { fetchAioCatalogs, type AioCatalog } from "../../data/aiostreams";
import {
  isValidManifestUrl,
  loadAioUrl,
  loadHeroSources,
  saveAioUrl,
  saveHeroSources,
} from "./aiostreams";
import {
  CARD_META_FIELDS,
  loadCardMeta,
  saveCardMeta,
  type CardMetaField,
} from "./cardMeta";
import {
  OVERLAY_META_FIELDS,
  loadOverlayMeta,
  saveOverlayMeta,
  type OverlayMetaField,
} from "./overlayMeta";
import { Toggle } from "../../ui/Toggle";
import {
  ROW_CAP_MAX,
  ROW_CAP_MIN,
  loadRowCap,
  saveRowCap,
} from "./rowCap";
import { loadSourceFailover, saveSourceFailover } from "./failover";
import { ChipTabs } from "../../ui/ChipTabs";
import {
  loadSkipBehavior,
  saveSkipBehavior,
  type SkipBehavior,
} from "./skipBehavior";

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

  // Submitting an emptied field removes the saved manifest (that's what
  // makes the in-field clear meaningful).
  const submittable = url.trim() === "" || isValidManifestUrl(url);
  const submit = () => {
    if (!submittable) return;
    saveAioUrl(url);
    setSavedUrl(url.trim());
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
        if (!alive) return;
        setCatalogs({ status: "ready", items });
        // Prune any saved hero selection the (possibly changed) manifest no
        // longer offers, so stale keys don't linger as raw-string chips or in
        // storage.
        const valid = new Set(items.map((c) => c.key));
        setSelected((sel) => {
          const pruned = sel.filter((k) => valid.has(k));
          if (pruned.length === sel.length) return sel;
          saveHeroSources(pruned);
          return pruned;
        });
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

  // Card details: which fields the browse cards show under the title.
  // Toggling saves immediately and the Stream home re-renders live.
  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  const toggleMeta = (key: CardMetaField) => {
    setMetaFields(
      saveCardMeta(
        metaFields.includes(key)
          ? metaFields.filter((k) => k !== key)
          : [...metaFields, key],
      ),
    );
  };

  // Player overlay text: what shows beside the title art during playback.
  const [overlayFields, setOverlayFields] =
    useState<OverlayMetaField[]>(loadOverlayMeta);
  const toggleOverlay = (key: OverlayMetaField) => {
    setOverlayFields(
      saveOverlayMeta(
        overlayFields.includes(key)
          ? overlayFields.filter((k) => k !== key)
          : [...overlayFields, key],
      ),
    );
  };

  // Catalog row size + auto source-failover. The slider steps by 5;
  // clicking the number swaps it for a type-in field (fine tune).
  const [rowCap, setRowCap] = useState<number>(loadRowCap);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const commitCap = () => {
    if (capDraft !== null) {
      const n = Number(capDraft);
      if (Number.isFinite(n) && capDraft.trim() !== "")
        setRowCap(saveRowCap(n)); // clamps to 10–100
    }
    setCapDraft(null);
  };
  const [failover, setFailover] = useState<boolean>(loadSourceFailover);
  const [skipBehavior, setSkipBehavior] =
    useState<SkipBehavior>(loadSkipBehavior);

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

      {savedUrl && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Card Details</h3>
          <p className="settings__section-note settings__section-note--dim">
            What shows under a card&rsquo;s title in the Stream rows. Runtime
            only appears where the catalog provides it.
          </p>
          <div className="meta-pick" role="group" aria-label="Card details">
            {CARD_META_FIELDS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="meta-pick__chip"
                aria-pressed={metaFields.includes(f.key)}
                onClick={() => toggleMeta(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {savedUrl && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Player Overlay</h3>
          <p className="settings__section-note settings__section-note--dim">
            What shows beside the title art while a movie or episode plays.
          </p>
          <div className="meta-pick" role="group" aria-label="Player overlay">
            {OVERLAY_META_FIELDS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="meta-pick__chip"
                aria-pressed={overlayFields.includes(f.key)}
                onClick={() => toggleOverlay(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {savedUrl && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Catalog Row Size</h3>
          <p className="settings__section-note settings__section-note--dim">
            How many titles each row loads. A higher cap results in longer
            load times.
          </p>
          <div className="rowcap">
            <input
              className="rowcap__slider"
              type="range"
              min={ROW_CAP_MIN}
              max={ROW_CAP_MAX}
              step={5}
              value={rowCap}
              aria-label="Titles per row"
              onChange={(e) => setRowCap(saveRowCap(Number(e.target.value)))}
            />
            {capDraft !== null ? (
              <input
                className="rowcap__value rowcap__value--edit"
                type="number"
                min={ROW_CAP_MIN}
                max={ROW_CAP_MAX}
                value={capDraft}
                autoFocus
                aria-label="Titles per row (exact)"
                onChange={(e) => setCapDraft(e.target.value)}
                onBlur={commitCap}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCap();
                  if (e.key === "Escape") setCapDraft(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="rowcap__value rowcap__value--btn"
                title="Click to type an exact value"
                onClick={() => setCapDraft(String(rowCap))}
              >
                {rowCap}
              </button>
            )}
          </div>
        </section>
      )}

      {savedUrl && (
        <section className="settings-section">
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Auto Source Failover</h4>
              <p className="settings__section-note settings__section-note--dim">
                When a source dies mid-play, jump to the next available
                cached one automatically — an uncached source is never
                auto-played. Off shows a button instead.
              </p>
            </div>
            <Toggle
              on={failover}
              onChange={() => {
                const next = !failover;
                setFailover(next);
                saveSourceFailover(next);
              }}
              label="Auto source failover"
            />
          </div>
        </section>
      )}

      {savedUrl && (
        <section className="settings-section">
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Skip Behavior</h4>
              <p className="settings__section-note settings__section-note--dim">
                The Skip Intro/Recap/Credits button over playback (from the
                file&rsquo;s chapters). Combine merges back-to-back credits
                and preview into one jump.
              </p>
            </div>
            <ChipTabs
              tabs={[
                { key: "hidden", label: "Hidden" },
                { key: "normal", label: "Normal" },
                { key: "combine", label: "Combine Credits & Preview" },
              ]}
              active={skipBehavior}
              onChange={(k: SkipBehavior) => {
                setSkipBehavior(k);
                saveSkipBehavior(k);
              }}
            />
          </div>
        </section>
      )}
    </>
  );
}
