import { useEffect, useState } from "react";
import { CloseIcon } from "../../ui/icons";
import { ChipTabs } from "../../ui/ChipTabs";
import { PlaylistsTab } from "./PlaylistsTab";
import { AioStreamsTab } from "./AioStreamsTab";

type SettingsTab = "playlists" | "aiostreams" | "customize";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "playlists", label: "Playlists" },
  { key: "aiostreams", label: "AIOStreams" },
  { key: "customize", label: "Customize" },
];

/** The floating settings card from the redesign: title left, chip-tab rail
 * center, close right. Playlists and AIOStreams are live; Customize fills in
 * later. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>("playlists");

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
          <ChipTabs tabs={TABS} active={tab} onChange={setTab} />
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
          {tab === "playlists" && <PlaylistsTab />}
          {tab === "aiostreams" && <AioStreamsTab />}
          {tab === "customize" && (
            <section className="settings-section">
              <h3 className="settings__section-title">Customize</h3>
              <p className="settings__section-note">
                Accent color, theme, and UI scale will live here.
              </p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
