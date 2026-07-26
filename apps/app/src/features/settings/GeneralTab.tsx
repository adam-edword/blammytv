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
import { loadAioUrl, saveAioUrl, saveHeroSources } from "./aiostreams";
import { loadSourceFailover, saveSourceFailover } from "./failover";
import {
  loadSkipBehavior,
  saveSkipBehavior,
  type SkipBehavior,
} from "./skipBehavior";
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

  // Playback behaviour, moved off the AIOStreams tab: what happens during a
  // play is behaviour, not a property of where the stream came from. Still
  // gated on a configured manifest, because without one there is no VOD
  // playback for either setting to govern. Read once per mount, so adding a
  // manifest reveals them the next time Settings opens.
  const hasAddon = useRef(loadAioUrl() !== "").current;
  const [failover, setFailover] = useState<boolean>(loadSourceFailover);
  const [skip, setSkip] = useState<SkipBehavior>(loadSkipBehavior);

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

        {hasAddon && (
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Auto Source Failover</h4>
              <p className="settings__section-note settings__section-note--dim">
                When a source dies mid-play, jump to the next available cached
                one automatically. An uncached source is never auto-played. Off
                shows a button instead.
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
        )}

        {hasAddon && (
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Skip Behavior</h4>
              <p className="settings__section-note settings__section-note--dim">
                The Skip Intro/Recap/Credits button over playback (from the
                file&rsquo;s chapters). Combine merges back-to-back credits and
                preview into one jump.
              </p>
            </div>
            <ChipTabs
              tabs={[
                { key: "hidden", label: "Hidden" },
                { key: "normal", label: "Normal" },
                { key: "combine", label: "Combine Credits & Preview" },
              ]}
              active={skip}
              onChange={(k: SkipBehavior) => {
                setSkip(k);
                saveSkipBehavior(k);
              }}
            />
          </div>
        )}
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
