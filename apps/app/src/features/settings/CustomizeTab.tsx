import { useState } from "react";
import {
  ACCENT_PRESETS,
  applyAccent,
  loadAccent,
  saveAccent,
} from "./accent";

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
            className={
              "accent-swatch" +
              (p.hex === accent ? " accent-swatch--active" : "")
            }
            style={{ background: p.hex }}
            onClick={() => pick(p.hex)}
          />
        ))}
        {/* The custom swatch is the native color picker wearing swatch clothes. */}
        <label
          className={
            "accent-swatch accent-swatch--custom" +
            (isCustom ? " accent-swatch--active" : "")
          }
          style={isCustom ? { background: accent } : undefined}
          title="Custom"
        >
          <input
            type="color"
            className="accent-swatch__input"
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
