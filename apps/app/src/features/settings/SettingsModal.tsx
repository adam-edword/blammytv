import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../ui/icons";
import { ChipTabs } from "../../ui/ChipTabs";
import { PlaylistsTab } from "./PlaylistsTab";
import { AioStreamsTab } from "./AioStreamsTab";
import { CustomizeTab } from "./CustomizeTab";
import {
  DEFAULT_PACK,
  applyThemePack,
  loadThemePack,
} from "./themePacks";
import { applyTheme, loadTheme } from "./theme";

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

  // Theme-preview boundary. Customize applies a picked pack live but only
  // COMMITS (writes storage) the ones the machine owns — an unowned pack is
  // an ephemeral preview. Persisted storage is therefore always the committed
  // baseline, so on modal close (this effect's cleanup — fires on ✕/backdrop/
  // Escape, NOT on tab switches, since this component only unmounts when
  // settingsOpen flips) we snap the DOM back to persisted if a preview is
  // live. No mount snapshot needed; reading storage is StrictMode-safe.
  useEffect(() => {
    return () => {
      const persisted = loadThemePack();
      const live =
        (document.documentElement.dataset.themePack as string) ?? DEFAULT_PACK;
      if (live !== persisted) {
        applyThemePack(persisted);
        applyTheme(loadTheme());
      }
    };
  }, []);

  // Portaled OUT of .app-shell: with the inverted player, the shell carries
  // a clip-path hole where the video shows — a modal rendered inside it
  // would have that hole cut through its middle. On body, the modal paints
  // above everything and the video keeps playing behind the backdrop.
  return createPortal(
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
          {tab === "customize" && <CustomizeTab />}
        </div>
      </section>
    </div>,
    document.body,
  );
}
