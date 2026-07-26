import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronIcon, CloseIcon } from "../../ui/icons";
import { fetchAioCatalogs, type AioCatalog } from "../../data/aiostreams";
import {
  isValidManifestUrl,
  loadAioUrl,
  loadHeroSources,
  saveHeroSources,
} from "./aiostreams";

/**
 * Which catalogs feed the Stream tab's hero carousel.
 *
 * Lives under Customize, not with the manifest: picking what the hero
 * shows is a decision about how the home screen LOOKS, not about the
 * connection that makes it possible. It reads the saved manifest to list
 * the catalogs on offer, which is the only thing it needs from Media.
 */

type Catalogs =
  | { status: "idle" | "loading" }
  | { status: "ready"; items: AioCatalog[] }
  | { status: "error" };

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function HeroSourcesSection() {
  // Read once per mount: this panel is not where the manifest is edited, so
  // there is nothing here that can change it under us.
  const savedUrl = useRef(loadAioUrl()).current;
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
        // Prune any saved selection the (possibly changed) manifest no
        // longer offers, so stale keys don't linger as raw-string chips or
        // in storage.
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

  // The "add sources" dropdown renders in a portal with fixed positioning
  // so it can float outside the settings card (which clips its own
  // overflow); anchored to the button, flipped upward when space runs out.
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

  // Renders as a stack, not a section: it is one control among several in
  // Customize's Stream panel, and its own rule and 21px heading made a
  // list of settings read as a list of pages.
  return (
    <div className="customize-stack">
      <div>
        <h4 className="customize-row__title">Hero Slider Sources</h4>
        <p className="settings__section-note settings__section-note--dim">
          The catalogs the hero pulls from, shuffled each load. Empty uses a
          mix of everything.
        </p>
      </div>
      {catalogs.status === "loading" && (
        <p className="settings__section-note settings__section-note--dim">
          Loading catalogs…
        </p>
      )}
      {catalogs.status === "error" && (
        <p className="settings__section-note settings__section-note--dim">
          Couldn&rsquo;t reach the manifest. Check the URL, and note the browser
          dev build can be blocked by CORS where the desktop app isn&rsquo;t.
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
                  onClick={() => update(selected.filter((k) => k !== key))}
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
                      transform: menuPos.up ? "translateY(-100%)" : undefined,
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
    </div>
  );
}
