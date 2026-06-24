import { useEffect, useState } from "react";
import { CloseIcon, ChevronIcon } from "./icons";
import { usePreferences } from "../state/preferences";
import { backendConfigured, listCatalogs, type CatalogOption } from "../lib/admin";

/** Customize → Carousel Sources: pick which catalogs the Stream hero pulls
 * from. The selection is a device pref sent to /config; the server builds 9
 * items spread evenly across the chosen lists, shuffled per load. */
export function CarouselSources({ onDirty }: { onDirty: () => void }) {
  const { prefs, setCarouselSources } = usePreferences();
  const [catalogs, setCatalogs] = useState<CatalogOption[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const configured = backendConfigured();

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

  const selected = prefs.carouselSources;
  const byId = new Map((catalogs ?? []).map((c) => [c.id, c]));
  const unselected = (catalogs ?? []).filter((c) => !selected.includes(c.id));

  const update = (ids: string[]) => {
    setCarouselSources(ids);
    onDirty();
  };

  const labelFor = (c: CatalogOption) => `${c.name} · ${typeLabel(c.type)}`;

  if (!configured) {
    return (
      <p className="settings__row-desc">
        Connect a backend to customize the carousel.
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
        {selected.map((id) => (
          <span key={id} className="carousel-chip">
            {byId.get(id) ? labelFor(byId.get(id)!) : id}
            <button
              type="button"
              aria-label="Remove"
              onClick={() => update(selected.filter((x) => x !== id))}
            >
              <CloseIcon size={14} />
            </button>
          </span>
        ))}

        <div className="carousel-add">
          <button
            type="button"
            className="carousel-chip carousel-chip--add"
            onClick={() => setAddOpen((o) => !o)}
          >
            add sources
            <ChevronIcon size={14} className="carousel-add__caret" />
          </button>
          {addOpen && (
            <div className="carousel-add__menu">
              {catalogs === null ? (
                <span className="carousel-add__note">Loading…</span>
              ) : unselected.length === 0 ? (
                <span className="carousel-add__note">Nothing left to add</span>
              ) : (
                unselected.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      update([...selected, c.id]);
                      setAddOpen(false);
                    }}
                  >
                    {labelFor(c)}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function typeLabel(type: string): string {
  if (type.includes("series")) return "Series";
  if (type.includes("movie")) return "Movie";
  return type;
}
