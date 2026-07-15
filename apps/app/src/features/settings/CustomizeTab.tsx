import { useEffect, useRef, useState } from "react";
import { remove as removeStored } from "../../lib/storage";
import { ChevronIcon } from "../../ui/icons";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import {
  ACCENT_PRESETS,
  applyAccent,
  saveAccent,
  saveAccentPairedBy,
  saveAccentStyle,
  saveCustomAccent,
} from "./accent";
import { applyTheme, saveTheme, type Theme } from "./theme";
import {
  DEFAULT_PACK,
  applyThemePack,
  saveThemePack,
} from "./themePacks";
import {
  UI_SCALES,
  applyUiScale,
  loadUiScale,
  saveUiScale,
  type UiScale,
} from "./uiScale";
import {
  CLOCK_TABS,
  loadClockFormat,
  saveClockFormat,
  type ClockFormat,
} from "./clockFormat";
import {
  loadShowChannelNumber,
  saveShowChannelNumber,
} from "./channelNumber";
import { loadOneClickPlay, saveOneClickPlay } from "./oneClickPlay";
import { UpdatesSection } from "./UpdatesSection";
import {
  applyCornerStyle,
  loadCornerStyle,
  saveCornerStyle,
  type CornerStyle,
} from "./cornerStyle";
import {
  STARTUP_TABS,
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "./startupTab";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";
import { requestOnboardingReplay } from "../../app/onboardingGate";

const SCALE_TABS = UI_SCALES.map((s) => ({
  key: String(s),
  label: `${Math.round(s * 100)}%`,
}));

// CLOCK_TABS lives in clockFormat.ts — one list shared with onboarding.

const CORNER_TABS: Array<{ key: CornerStyle; label: string }> = [
  { key: "squircle", label: "Squircle" },
  { key: "round", label: "Round" },
  { key: "sharp", label: "Sharp" },
];

// STARTUP_TABS lives in startupTab.ts — one list shared with onboarding.

type CustomizeSection = "general" | "display";

// Themes are their own pop-out panel now — the old "Theme" pill is gone; the
// launcher at the top opens it. Accent + packs + Pass all live there.
const SECTION_TABS: Array<{ key: CustomizeSection; label: string }> = [
  { key: "general", label: "General" },
  { key: "display", label: "Display" },
];

export function CustomizeTab({ onOpenThemes }: { onOpenThemes: () => void }) {
  // Which pill is showing — ephemeral, always opens back on General.
  const [sec, setSec] = useState<CustomizeSection>("general");

  // Light/dark axis state exists only so reset() can force dark — the user
  // control (the Theme Style pill) lives in the Themes panel now.
  const pickTheme = (next: Theme) => {
    saveTheme(next);
    applyTheme(next);
  };

  const [scale, setScale] = useState<UiScale>(loadUiScale);
  const pickScale = (next: UiScale) => {
    setScale(next);
    saveUiScale(next);
    applyUiScale(next);
  };

  const [clock, setClock] = useState<ClockFormat>(loadClockFormat);
  const pickClock = (next: ClockFormat) => {
    setClock(next);
    saveClockFormat(next);
  };

  const [corners, setCorners] = useState<CornerStyle>(loadCornerStyle);
  const pickCorners = (next: CornerStyle) => {
    setCorners(next);
    saveCornerStyle(next);
    applyCornerStyle(next);
  };

  const [startup, setStartup] = useState<StartupTab>(loadStartupTab);
  const pickStartup = (next: StartupTab) => {
    setStartup(next);
    saveStartupTab(next);
  };

  const [chanNum, setChanNum] = useState<boolean>(loadShowChannelNumber);
  const toggleChanNum = () => {
    const next = !chanNum;
    setChanNum(next);
    saveShowChannelNumber(next);
  };

  const [oneClick, setOneClick] = useState<boolean>(loadOneClickPlay);
  const toggleOneClick = () => {
    const next = !oneClick;
    setOneClick(next);
    saveOneClickPlay(next);
  };

  /** Back to factory appearance: default accent (custom slot cleared),
   * default theme pack, dark theme, squircle corners, 100% scale, 12h
   * clock, open on Live, channel numbers shown. Accent + pack reset go
   * straight through the storage/apply seams (their live state lives in the
   * Themes panel, which isn't mounted here). */
  const reset = () => {
    saveAccent(ACCENT_PRESETS[0].hex);
    applyAccent(ACCENT_PRESETS[0].hex); // also exits aurora
    saveAccentStyle("flat");
    saveAccentPairedBy(""); // factory accent = no pack pairing
    saveCustomAccent("");
    saveThemePack(DEFAULT_PACK);
    applyThemePack(DEFAULT_PACK);
    pickTheme("dark");
    pickCorners("squircle");
    pickScale(1);
    pickClock("12h");
    pickStartup("live");
    setChanNum(true);
    saveShowChannelNumber(true);
  };

  // Clearing credentials is destructive, so it takes two clicks: arm, then
  // confirm within a few seconds.
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimer = useRef(0);
  // Closing Settings while armed would otherwise fire setState on an unmounted
  // component when the 4s timer elapses.
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  const clearLogins = () => {
    if (!clearArmed) {
      setClearArmed(true);
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(
        () => setClearArmed(false),
        4000,
      );
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
      {/* Themes launcher — pops the standalone Themes panel out and closes
          Settings (App wires onOpenThemes). Replaces the old Theme sub-tab. */}
      <button type="button" className="themes-launch" onClick={onOpenThemes}>
        <span className="themes-launch__text">
          <span className="themes-launch__title">Themes</span>
          <span className="themes-launch__hint">
            Accent, theme packs, and the Themes Pass.
          </span>
        </span>
        <ChevronIcon className="themes-launch__chevron" />
      </button>

      <div className="customize-rail">
        <ChipTabs tabs={SECTION_TABS} active={sec} onChange={setSec} />
      </div>

      {sec === "general" && (
        <section className="settings-section">
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Clock Format</h4>
              <p className="settings__section-note settings__section-note--dim">
                How the header clock reads.
              </p>
            </div>
            <ChipTabs tabs={CLOCK_TABS} active={clock} onChange={pickClock} />
          </div>

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
              <h4 className="customize-row__title">Channel Numbers</h4>
              <p className="settings__section-note settings__section-note--dim">
                Show the provider&rsquo;s channel number beside the name.
              </p>
            </div>
            <Toggle
              on={chanNum}
              onChange={toggleChanNum}
              label="Show channel numbers"
            />
          </div>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">One-Click Play Movies</h4>
              <p className="settings__section-note settings__section-note--dim">
                Clicking a movie poster card plays the best source right
                away, and it will never play an uncached source.
              </p>
            </div>
            <Toggle
              on={oneClick}
              onChange={toggleOneClick}
              label="One-click play"
            />
          </div>
        </section>
      )}

      {/* App-level, not per-appearance-axis — only shown under General so it
       * doesn't repeat across the Display tab. */}
      {sec === "general" && (
        <>
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
                  <h4 className="customize-row__title">Reset Appearance</h4>
                  <p className="settings__section-note settings__section-note--dim">
                    Accent, theme, corners, scale, clock, and startup tab back
                    to defaults.
                  </p>
                </div>
                <button type="button" className="btn-danger" onClick={reset}>
                  Reset
                </button>
              </div>

              <div className="customize-row">
                <div>
                  <h4 className="customize-row__title">Clear All Login Info</h4>
                  <p className="settings__section-note settings__section-note--dim">
                    Removes every playlist and your AIOStreams manifest from
                    this device.
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
      )}

      {sec === "display" && (
        <section className="settings-section">
          {/* Light/Dark now lives in the Themes panel (Theme Style pill). */}
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">UI Scale</h4>
              <p className="settings__section-note settings__section-note--dim">
                Make everything bigger or smaller.
              </p>
            </div>
            <ChipTabs
              tabs={SCALE_TABS}
              active={String(scale)}
              onChange={(key) => pickScale(Number(key) as UiScale)}
            />
          </div>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Corner Style</h4>
              <p className="settings__section-note settings__section-note--dim">
                The shape of every corner in the app.
              </p>
            </div>
            <ChipTabs
              tabs={CORNER_TABS}
              active={corners}
              onChange={pickCorners}
            />
          </div>
        </section>
      )}
    </>
  );
}
