import { useState } from "react";
import { CheckIcon } from "../../ui/icons";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import {
  ACCENT_PRESETS,
  applyAccent,
  loadAccent,
  loadCustomAccent,
  saveAccent,
  saveCustomAccent,
} from "./accent";
import { applyTheme, loadTheme, saveTheme, type Theme } from "./theme";
import {
  UI_SCALES,
  applyUiScale,
  loadUiScale,
  saveUiScale,
  type UiScale,
} from "./uiScale";
import {
  loadClockFormat,
  saveClockFormat,
  type ClockFormat,
} from "./clockFormat";
import {
  applyCornerStyle,
  loadCornerStyle,
  saveCornerStyle,
  type CornerStyle,
} from "./cornerStyle";
import {
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "./startupTab";

const SCALE_TABS = UI_SCALES.map((s) => ({
  key: String(s),
  label: `${Math.round(s * 100)}%`,
}));

const CLOCK_TABS: Array<{ key: ClockFormat; label: string }> = [
  { key: "12h", label: "12h" },
  { key: "24h", label: "24h" },
];

const CORNER_TABS: Array<{ key: CornerStyle; label: string }> = [
  { key: "squircle", label: "Squircle" },
  { key: "round", label: "Round" },
  { key: "sharp", label: "Sharp" },
];

const STARTUP_TABS: Array<{ key: StartupTab; label: string }> = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
  { key: "discover", label: "Discover" },
];

/** Swatch look: the color's 16% surface tint as fill, the pure color as the
 * border — the same recipe the accent family uses app-wide (--mix-base keeps
 * the tint tracking the theme). */
function swatchStyle(hex: string) {
  return {
    background: `color-mix(in srgb, ${hex} 16%, var(--mix-base))`,
    borderColor: hex,
  };
}

export function CustomizeTab() {
  const [accent, setAccent] = useState(loadAccent);
  // The custom slot keeps its color even while a preset is selected.
  const [custom, setCustom] = useState(loadCustomAccent);
  const isCustomActive = accent === custom && custom !== "";

  const pick = (hex: string) => {
    const value = hex.toLowerCase();
    setAccent(value);
    saveAccent(value);
    applyAccent(value);
  };

  const pickCustom = (hex: string) => {
    const value = hex.toLowerCase();
    setCustom(value);
    saveCustomAccent(value);
    pick(value);
  };

  const [theme, setTheme] = useState<Theme>(loadTheme);
  const pickTheme = (next: Theme) => {
    setTheme(next);
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

  /** Back to factory appearance: default accent (custom slot cleared),
   * dark theme, squircle corners, 100% scale, 12h clock, open on Live. */
  const reset = () => {
    pick(ACCENT_PRESETS[0].hex);
    setCustom("");
    saveCustomAccent("");
    pickTheme("dark");
    pickCorners("squircle");
    pickScale(1);
    pickClock("12h");
    pickStartup("live");
  };

  return (
    <>
      <section className="settings-section">
        <h3 className="settings__section-title">General</h3>

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
      </section>

      <section className="settings-section">
        <h3 className="settings__section-title">Theme</h3>

        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Accent Color</h4>
            <p className="settings__section-note settings__section-note--dim">
              Used for highlights, toggles, and buttons across the app.
            </p>
          </div>
          <div
            className="accent-row"
            role="radiogroup"
            aria-label="Accent color"
          >
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.hex}
                type="button"
                role="radio"
                aria-checked={p.hex === accent}
                aria-label={p.name}
                title={p.name}
                className="accent-swatch"
                style={swatchStyle(p.hex)}
                onClick={() => pick(p.hex)}
              >
                {p.hex === accent && (
                  <CheckIcon className="accent-swatch__check" />
                )}
              </button>
            ))}
            {/* The custom chip is the native color picker wearing chip clothes. */}
            <label
              className={
                "accent-custom" +
                (isCustomActive ? " accent-custom--active" : "")
              }
              title="Custom"
              // Clicking applies the remembered custom color right away (the
              // native picker also opens via the label; changes there apply
              // live and whatever it's on at close wins).
              onClick={() => {
                if (custom) pick(custom);
              }}
            >
              <span
                className="accent-swatch"
                style={custom ? swatchStyle(custom) : undefined}
              >
                {isCustomActive && (
                  <CheckIcon className="accent-swatch__check" />
                )}
              </span>
              Custom
              <input
                type="color"
                className="accent-custom__input"
                value={custom || accent}
                aria-label="Custom accent color"
                onChange={(e) => pickCustom(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Light Theme</h4>
            <p className="settings__section-note settings__section-note--dim">
              Flip the whole app to a light palette.
            </p>
          </div>
          <Toggle
            on={theme === "light"}
            onChange={(on) => pickTheme(on ? "light" : "dark")}
            label="Light theme"
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings__section-title">Display</h3>

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

        <button type="button" className="customize-reset" onClick={reset}>
          Reset appearance
        </button>
      </section>
    </>
  );
}
