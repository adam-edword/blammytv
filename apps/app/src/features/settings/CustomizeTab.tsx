import { useState } from "react";
import { CheckIcon, PencilIcon } from "../../ui/icons";
import {
  ACCENT_PRESETS,
  applyAccent,
  loadAccent,
  saveAccent,
} from "./accent";

/** Swatch look: the color's dark 16% surface as fill, the pure color as the
 * border — the same recipe the accent family uses app-wide. */
function swatchStyle(hex: string) {
  return {
    background: `color-mix(in srgb, ${hex} 16%, black)`,
    borderColor: hex,
  };
}

export function CustomizeTab() {
  const [accent, setAccent] = useState(loadAccent);
  const isCustom = !ACCENT_PRESETS.some((p) => p.hex === accent);

  const pick = (hex: string) => {
    const value = hex.toLowerCase();
    setAccent(value);
    saveAccent(value);
    applyAccent(value);
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
        {/* The custom chip is the native color picker wearing chip clothes:
            mini swatch (the current custom color, or neutral) + pencil + label. */}
        <label
          className={
            "accent-custom" + (isCustom ? " accent-custom--active" : "")
          }
          title="Custom"
        >
          <span
            className="accent-swatch accent-custom__swatch"
            style={isCustom ? swatchStyle(accent) : undefined}
          >
            {isCustom && <CheckIcon className="accent-swatch__check" />}
          </span>
          <PencilIcon className="accent-custom__pen" />
          Custom
          <input
            type="color"
            className="accent-custom__input"
            value={accent}
            aria-label="Custom accent color"
            onChange={(e) => pick(e.target.value)}
          />
        </label>
      </div>
      <p className="settings__section-note settings__section-note--dim">
        Theme and UI scale will join here later.
      </p>
    </section>
  );
}
