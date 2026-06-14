import { useEffect } from "react";
import { CloseIcon, PencilIcon } from "./icons";
import {
  usePreferences,
  UI_SCALE_OPTIONS,
  nearestScaleIndex,
} from "../state/preferences";

/**
 * Settings panel.
 *
 * App + display preferences. A dim backdrop over the whole window with a panel
 * anchored top-right (per the Figma mock). Dismissable via backdrop click,
 * Escape, or the close button.
 *
 * These are device-local *display* prefs; real channel/source config still
 * lives in the web UI per the architecture.
 */

/** Quick-pick accent swatches; the custom picker covers everything else. */
const ACCENT_PRESETS = [
  "#c22727", // red (default)
  "#ffd500", // yellow
  "#2cad57", // green
  "#3730ff", // blue
  "#a200ff", // purple
  "#ff2773", // pink
  "#9aa0b1", // grey
];

export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { prefs, setAccent, setUiScale, setLightMode, reset } =
    usePreferences();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeAccent = prefs.accent.toLowerCase();
  const isCustomAccent = !ACCENT_PRESETS.some(
    (c) => c.toLowerCase() === activeAccent,
  );
  const scaleIndex = nearestScaleIndex(prefs.uiScale);
  const lastScale = UI_SCALE_OPTIONS.length - 1;

  const setScaleIndex = (i: number) =>
    setUiScale(UI_SCALE_OPTIONS[Math.max(0, Math.min(lastScale, i))].value);

  const onScaleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setScaleIndex(scaleIndex + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setScaleIndex(scaleIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setScaleIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setScaleIndex(lastScale);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-btn settings-panel__close"
          type="button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className="settings__inner">
          <h2 className="settings__title">Settings</h2>

          <section className="settings__section">
            <h3 className="settings__section-title">Display</h3>

            {/* Accent colour */}
            <div className="settings__row">
              <div className="settings__row-label">
                <span className="settings__row-title">Accent colour</span>
                <span className="settings__row-desc">
                  Used for highlights, the live marker, and selection.
                </span>
              </div>
              <div className="settings__control settings__swatches">
                {ACCENT_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={
                      "swatch" +
                      (c.toLowerCase() === activeAccent ? " swatch--active" : "")
                    }
                    style={{ background: c }}
                    aria-label={`Accent ${c}`}
                    aria-pressed={c.toLowerCase() === activeAccent}
                    onClick={() => setAccent(c)}
                  />
                ))}
                <label
                  className={
                    "settings__custom-btn" + (isCustomAccent ? " is-active" : "")
                  }
                  title="Custom colour"
                >
                  <PencilIcon size={15} />
                  <span>Custom</span>
                  <input
                    type="color"
                    value={prefs.accent}
                    onChange={(e) => setAccent(e.target.value)}
                    aria-label="Custom accent colour"
                  />
                </label>
              </div>
            </div>

            {/* UI scale */}
            <div className="settings__row">
              <div className="settings__row-label">
                <span className="settings__row-title">UI scale</span>
                <span className="settings__row-desc">
                  Make everything larger or smaller.
                </span>
              </div>
              <div className="settings__control settings__scale">
                <div
                  className="scaleslider"
                  role="slider"
                  tabIndex={0}
                  aria-label="UI scale"
                  aria-valuemin={0}
                  aria-valuemax={lastScale}
                  aria-valuenow={scaleIndex}
                  aria-valuetext={UI_SCALE_OPTIONS[scaleIndex].label}
                  onKeyDown={onScaleKey}
                >
                  <div className="scaleslider__line" />
                  <div
                    className="scaleslider__fill"
                    style={{ width: `calc((100% - 24px) * ${scaleIndex / lastScale})` }}
                  />
                  {UI_SCALE_OPTIONS.map((o, i) => (
                    <button
                      key={o.label}
                      type="button"
                      tabIndex={-1}
                      className={
                        "scalenotch" +
                        (i <= scaleIndex ? " is-filled" : "") +
                        (i === scaleIndex ? " is-active" : "")
                      }
                      style={{ left: `calc(12px + (100% - 24px) * ${i / lastScale})` }}
                      onClick={() => setUiScale(o.value)}
                      aria-label={o.label}
                    >
                      <span className="scalenotch__bar" />
                      <span className="scalenotch__label">{o.label}</span>
                    </button>
                  ))}
                  <span
                    className="scaleslider__thumb"
                    style={{
                      left: `calc(12px + (100% - 24px) * ${scaleIndex / lastScale})`,
                    }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>

            {/* Light mode */}
            <div className="settings__row">
              <div className="settings__row-label">
                <span className="settings__row-title">
                  Light mode
                  <span className="settings__badge">Coming soon</span>
                </span>
                <span className="settings__row-desc">
                  A light theme isn't ready yet — the preference is saved for
                  when it lands.
                </span>
              </div>
              <div className="settings__control">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={prefs.lightMode}
                    onChange={(e) => setLightMode(e.target.checked)}
                    aria-label="Light mode"
                  />
                  <span className="toggle__track">
                    <span className="toggle__thumb" />
                  </span>
                </label>
              </div>
            </div>
          </section>

          <div className="settings__footer">
            <button className="btn" type="button" onClick={reset}>
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
