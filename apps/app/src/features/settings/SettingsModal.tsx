import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon } from "../../ui/icons";

type SettingsTab = "playlists" | "aiostreams" | "customize";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "playlists", label: "Playlists" },
  { key: "aiostreams", label: "AIOStreams" },
  { key: "customize", label: "Customize" },
];

/** The floating settings card from the redesign: title left, chip-tab row,
 * close button right. Tab bodies fill in as their features land — Playlists
 * with the Live tab, AIOStreams with the Stream tab. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>("playlists");

  // The active-chip highlight is a single thumb that slides between chips.
  // Position it off the active button's measured offset within the rail.
  const railRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const btn = railRef.current?.querySelector<HTMLButtonElement>(
      `[data-tab="${tab}"]`,
    );
    if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="settings"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings__header">
          <h2 className="settings__title">Settings</h2>
          <div className="settings__tabs" ref={railRef}>
            {thumb && (
              <span
                className="settings__tab-thumb"
                style={{ left: thumb.left, width: thumb.width }}
                aria-hidden
              />
            )}
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                data-tab={t.key}
                className={
                  "settings__tab" +
                  (t.key === tab ? " settings__tab--active" : "")
                }
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="settings__close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings__body">
          {tab === "playlists" && (
            <SettingsSection
              title="Playlists"
              note="Your live-TV sources — Xtream, M3U, or Stalker portals — get added and managed here once the Live tab lands."
            />
          )}
          {tab === "aiostreams" && (
            <SettingsSection
              title="AIOStreams Manifest"
              note="Your AIOStreams manifest URL powers the movies and shows under Stream. This hooks up when the Stream tab lands."
            />
          )}
          {tab === "customize" && (
            <SettingsSection
              title="Customize"
              note="Accent color, theme, and UI scale will live here."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsSection({ title, note }: { title: string; note: string }) {
  return (
    <div className="settings__section">
      <h3 className="settings__section-title">{title}</h3>
      <p className="settings__section-note">{note}</p>
    </div>
  );
}
