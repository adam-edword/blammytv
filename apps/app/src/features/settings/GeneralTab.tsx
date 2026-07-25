import { useEffect, useRef, useState } from "react";
import { remove as removeStored } from "../../lib/storage";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import { loadOneClickPlay, saveOneClickPlay } from "./oneClickPlay";
import { UpdatesSection } from "./UpdatesSection";
import {
  STARTUP_TABS,
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "./startupTab";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";
import { requestOnboardingReplay } from "../../app/onboardingGate";

/**
 * General: how the app BEHAVES, and how it is managed.
 *
 * Split out of Customize, which had grown into a pile of unrelated things:
 * app updates and the Danger Zone sat beside accent colours, so the tab
 * answered two different questions at once. The rule now is that Media is
 * where content comes from, General is behaviour and app management, and
 * Customize is only how the app looks.
 */
export function GeneralTab() {
  const [startup, setStartup] = useState<StartupTab>(loadStartupTab);
  const pickStartup = (next: StartupTab) => {
    setStartup(next);
    saveStartupTab(next);
  };

  const [oneClick, setOneClick] = useState<boolean>(loadOneClickPlay);
  const toggleOneClick = () => {
    const next = !oneClick;
    setOneClick(next);
    saveOneClickPlay(next);
  };

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
      <section className="settings-section">
        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Startup Tab</h4>
            <p className="settings__section-note settings__section-note--dim">
              Where the app opens.
            </p>
          </div>
          <ChipTabs
            tabs={STARTUP_TABS}
            active={startup}
            onChange={pickStartup}
          />
        </div>

        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">One-Click Play Movies</h4>
            <p className="settings__section-note settings__section-note--dim">
              Clicking a movie poster card plays the best source right away,
              and it will never play an uncached source.
            </p>
          </div>
          <Toggle
            on={oneClick}
            onChange={toggleOneClick}
            label="One-click play"
          />
        </div>
      </section>

      <section className="settings-section">
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

      <UpdatesSection />

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
