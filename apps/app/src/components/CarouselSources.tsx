import { useEffect, useState } from "react";
import { CloseIcon, ChevronIcon } from "./icons";
import { savePreferences, usePreferences } from "../state/preferences";
import { backendConfigured, listCatalogs, type CatalogOption } from "../lib/admin";
import { isTauri } from "../lib/tauri";
import { getAioUrl } from "../lib/settings";
import { FocusButton } from "./FocusButton";

/** Customize → Carousel Sources: pick which catalogs the Stream hero pulls
 * from. Edits build up a draft; **Save** persists it and rebuilds the carousel
 * (closing the panel never forces a rebuild). The selection is a device pref
 * sent to /config; the server picks 9 spread evenly across the chosen lists. */
export function CarouselSources({ onSaved }: { onSaved: () => void }) {
  const { prefs, setCarouselSources } = usePreferences();
  const [catalogs, setCatalogs] = useState<CatalogOption[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(prefs.carouselSources);
  const configured = isTauri() ? Boolean(getAioUrl()) : backendConfigured();

  useEffect(() => {
    if (!configured) {
      setCatalogs([]);
      return;
    }
    let alive = true;
    listCatalogs()
      .then((c) => alive && setCatalogs(c))
      .catch(() => alive && setCatalogs([]));
    return () => {
      alive = false;
    };
  }, [configured]);

  const byId = new Map((catalogs ?? []).map((c) => [c.id, c]));
  const unselected = (catalogs ?? []).filter((c) => !draft.includes(c.id));
  const dirty = draft.join(",") !== prefs.carouselSources.join(",");
  const labelFor = (c: CatalogOption) => `${c.name} · ${typeLabel(c.type)}`;

  const save = () => {
    // Persist now so the immediate re-pull reads the fresh selection, then keep
    // React state in sync, then rebuild.
    savePreferences({ ...prefs, carouselSources: draft });
    setCarouselSources(draft);
    onSaved();
  };

  if (!configured) {
    return (
      <p className="settings__row-desc">
        Add your AIOStreams URL first to customize the carousel.
      </p>
    );
  }

  return (
    <div className="carousel-sources">
      <span className="settings__row-title">Carousel sources</span>
      <p className="settings__row-desc">
        The carousel pulls 9 titles from the selected lists, spread evenly and
        shuffled on each load. Leave empty for the default mix.
      </p>

      <div className="carousel-chips">
        {draft.map((id) => (
          <span key={id} className="carousel-chip">
            {byId.get(id) ? labelFor(byId.get(id)!) : id}
            <FocusButton
              focusKey={`set-carousel-remove-${id}`}
              ariaLabel="Remove"
              onPress={() => setDraft((d) => d.filter((x) => x !== id))}
            >
              <CloseIcon size={14} />
            </FocusButton>
          </span>
        ))}

        <div className="carousel-add">
          <FocusButton
            focusKey="set-carousel-add"
            className="carousel-chip carousel-chip--add"
            onPress={() => setAddOpen((o) => !o)}
          >
            add sources
            <ChevronIcon size={14} className="carousel-add__caret" />
          </FocusButton>
          {addOpen && (
            <div className="carousel-add__menu">
              {catalogs === null ? (
                <span className="carousel-add__note">Loading…</span>
              ) : unselected.length === 0 ? (
                <span className="carousel-add__note">Nothing left to add</span>
              ) : (
                unselected.map((c) => (
                  <FocusButton
                    key={c.id}
                    focusKey={`set-carousel-opt-${c.id}`}
                    onPress={() => {
                      setDraft((d) => [...d, c.id]);
                      setAddOpen(false);
                    }}
                  >
                    {labelFor(c)}
                  </FocusButton>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="carousel-sources__actions">
        <FocusButton
          className="btn btn--primary"
          focusKey="set-carousel-save"
          disabled={!dirty}
          onPress={save}
        >
          Save
        </FocusButton>
      </div>
    </div>
  );
}

function typeLabel(type: string): string {
  if (type.includes("series")) return "Series";
  if (type.includes("movie")) return "Movie";
  return type;
}
