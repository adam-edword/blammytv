import { useEffect, useRef, useState } from "react";
import { remove as removeStored } from "../../lib/storage";
import { ChipTabs } from "../../ui/ChipTabs";
import { UpdatesSection } from "./UpdatesSection";
import { PlaylistsTab } from "./PlaylistsTab";
import { AioStreamsTab } from "./AioStreamsTab";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";
import { requestOnboardingReplay } from "../../app/onboardingGate";

/**
 * General: where content comes from, and how the app is managed. Anything
 * that belongs to ONE side of the app (how Stream looks, how it plays)
 * lives under Customize with the rest of that world; what is left here is
 * the connection itself and app-level management, Danger Zone last as in
 * every tab.
 *
 * Sources absorbed what used to be its own Media tab. Connecting a playlist
 * or a manifest is a one-time setup, so it earns a section rather than a
 * third of the rail, and the Live TV / Stream split it needs is the same
 * split Customize uses one tab over: one mental model, two places.
 */
const SOURCE_TABS = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
] as const;

export function GeneralTab() {
  // Ephemeral: Sources always opens on Live TV rather than remembering
  // where you were, the same rule the old Media rail followed.
  const [source, setSource] = useState<"live" | "stream">("live");

  // Clearing credentials is destructive, so it takes two clicks: arm, then
  // confirm within a few seconds.
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimer = useRef(0);
  // Closing Settings while armed would otherwise fire setState on an
  // unmounted component when the 4s timer elapses.
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  const clearLogins = () => {
    if (!clearArmed) {
      setClearArmed(true);
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    window.clearTimeout(clearTimer.current);
    setClearArmed(false);
    savePlaylists([]);
    saveAioUrl("");
    saveHeroSources([]);
    // The catalog mirror embeds the manifest URL (a credential) in its
    // key — an explicit credential clear must take it too.
    removeStored("vodCache");
  };

  return (
    <>
      {/* Where content comes from. The two source screens are unchanged;
        * they just sit behind a pill here instead of behind a tab. */}
      <h3 className="settings__group">Sources</h3>
      <div className="customize-rail">
        <ChipTabs tabs={SOURCE_TABS} active={source} onChange={setSource} />
      </div>
      {source === "live" ? <PlaylistsTab /> : <AioStreamsTab />}

      {/* Same shape as Customize: a group heading, then ONE section holding
        * every setting in it as a row. */}
      <h3 className="settings__group">App</h3>
      <section className="settings-section">
        <UpdatesSection />

        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Replay Onboarding</h4>
            <p className="settings__section-note settings__section-note--dim">
              Walk through the welcome setup again. Nothing gets reset.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={requestOnboardingReplay}
          >
            Replay
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="danger-zone">
          <h3 className="danger-zone__title">Danger Zone</h3>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Clear All Login Info</h4>
              <p className="settings__section-note settings__section-note--dim">
                Removes every playlist and your AIOStreams manifest from this
                device.
              </p>
            </div>
            <button
              type="button"
              className={
                "btn-danger" + (clearArmed ? " btn-danger--armed" : "")
              }
              onClick={clearLogins}
            >
              {clearArmed ? "Click again to confirm" : "Clear…"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
