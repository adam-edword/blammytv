import { useState } from "react";
import { CheckIcon } from "../../ui/icons";
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

  return (
    <section className="settings-section">
      <h3 className="settings__section-title">Accent Color</h3>
      <p className="settings__section-note">
        The color used for highlights, toggles, and buttons across the app.
      </p>
      <div className="accent-row" role="radiogroup" aria-label="Accent color">
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
            {p.hex === accent && <CheckIcon className="accent-swatch__check" />}
          </button>
        ))}
        {/* The custom chip is the native color picker wearing chip clothes. */}
        <label
          className={
            "accent-custom" + (isCustomActive ? " accent-custom--active" : "")
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
            {isCustomActive && <CheckIcon className="accent-swatch__check" />}
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

      <p className="settings__section-note settings__section-note--dim">
        UI scale will join here later.
      </p>
    </section>
  );
}
