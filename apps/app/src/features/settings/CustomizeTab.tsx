import { useState } from "react";
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
import {
  applyCornerStyle,
  loadCornerStyle,
  saveCornerStyle,
  type CornerStyle,
} from "./cornerStyle";

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

// Themes are their own pop-out panel now — the old "Theme" pill is gone; the
// launcher at the top opens it. Accent + packs + Pass all live there.
export function CustomizeTab({ onOpenThemes }: { onOpenThemes: () => void }) {
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

  const [chanNum, setChanNum] = useState<boolean>(loadShowChannelNumber);
  const toggleChanNum = () => {
    const next = !chanNum;
    setChanNum(next);
    saveShowChannelNumber(next);
  };

  /** Back to factory appearance: default accent (custom slot cleared),
   * default theme pack, dark theme, squircle corners, 100% scale, 12h
   * clock, channel numbers shown. Startup Tab is NOT reset here any more:
   * it moved to General, and this button resets appearance. Accent + pack reset go
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
    setChanNum(true);
    saveShowChannelNumber(true);
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


      {(
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
        </section>
      )}

      {(
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

      {/* Danger Zone is always the last section in a tab. Reset Appearance
        * stays here with the things it resets. Updates, Replay Onboarding and
        * Clear All Login Info moved to General: app management, not
        * personalization. */}
      <section className="settings-section">
        <div className="danger-zone">
          <h3 className="danger-zone__title">Danger Zone</h3>
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Reset Appearance</h4>
              <p className="settings__section-note settings__section-note--dim">
                Accent, theme, corners, scale, and clock back to defaults.
              </p>
            </div>
            <button type="button" className="btn-danger" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
