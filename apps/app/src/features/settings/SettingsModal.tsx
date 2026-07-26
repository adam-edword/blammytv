import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../ui/icons";
import { useClosingExit } from "./useClosingExit";
import { ChipTabs } from "../../ui/ChipTabs";
import { PlaylistsTab } from "./PlaylistsTab";
import { AioStreamsTab } from "./AioStreamsTab";
import { CustomizeTab } from "./CustomizeTab";
import { GeneralTab } from "./GeneralTab";

/**
 * Three questions, one tab each: where content comes from (Media), how the
 * app behaves and is managed (General), and how it looks (Customize).
 *
 * The old rail was Playlists / AIOStreams / Customize, which asked the user
 * to know that "the place your app updates live" was under Customize, next
 * to accent colours. Media groups the two source screens behind one heading
 * and keeps their own tabs one level down.
 *
 * The split is by QUESTION, not by which screen a setting happens to affect.
 * The AIOStreams tab is the connection to an addon and nothing else: what
 * its catalogs look like (card details, player overlay, row size) sits in
 * Customize, and how playback behaves (skip behaviour, source failover)
 * sits in General, both alongside the settings they resemble rather than
 * the credential that enables them.
 */
type SettingsTab = "media" | "general" | "customize";
type MediaTab = "playlists" | "aiostreams";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "media", label: "Media" },
  { key: "general", label: "General" },
  { key: "customize", label: "Customize" },
];

const MEDIA_TABS: Array<{ key: MediaTab; label: string }> = [
  { key: "playlists", label: "Playlists" },
  { key: "aiostreams", label: "AIOStreams" },
];

/** The floating settings card from the redesign: title left, chip-tab rail
 * center, close right. Themes are no longer a tab here — Customize carries a
 * launcher that pops the standalone Themes panel out (onOpenThemes), and the
 * theme preview/commit/revert boundary lives in that panel now. */
export function SettingsModal({
  onClose,
  onOpenThemes,
}: {
  onClose: () => void;
  onOpenThemes: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("media");
  // Ephemeral, like Customize's old inner rail: Media always opens on
  // Playlists rather than remembering where you were last time.
  const [media, setMedia] = useState<MediaTab>("playlists");
  const { closing, requestClose } = useClosingExit(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // requestClose is stable-enough (state guard inside); re-binding per
    // closing flip is harmless.
  });

  // Portaled OUT of .app-shell: with the inverted player, the shell carries
  // a clip-path hole where the video shows — a modal rendered inside it
  // would have that hole cut through its middle. On body, the modal paints
  // above everything and the video keeps playing behind the backdrop.
  return createPortal(
    <div className="modal-backdrop" onClick={requestClose}>
      <section
        className={"settings" + (closing ? " settings--closing" : "")}
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
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings__body">
          {tab === "media" && (
            <>
              <div className="customize-rail">
                <ChipTabs tabs={MEDIA_TABS} active={media} onChange={setMedia} />
              </div>
              {media === "playlists" && <PlaylistsTab />}
              {media === "aiostreams" && <AioStreamsTab />}
            </>
          )}
          {tab === "general" && <GeneralTab />}
          {tab === "customize" && <CustomizeTab onOpenThemes={onOpenThemes} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}
