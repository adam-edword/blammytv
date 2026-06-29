import { useEffect, useRef, useState } from "react";
import {
  FocusContext,
  setFocus,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { CloseIcon, PencilIcon } from "./icons";
import {
  usePreferences,
  UI_SCALE_OPTIONS,
  nearestScaleIndex,
} from "../state/preferences";
import { PlaylistsSettings } from "./PlaylistsSettings";
import { CarouselSources } from "./CarouselSources";
import { AioStreamsSettings } from "./AioStreamsSettings";
import { FocusButton } from "./FocusButton";
import { FocusToggle } from "./FocusToggle";
import { useUpdater } from "../state/updater";
import { isTauri } from "../lib/tauri";

/** The header settings button — focus returns here when the panel closes. */
const SETTINGS_BTN_KEY = "hdr-settings";
const tabKey = (t: SettingsTab) => `set-tab-${t}`;

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

type SettingsTab = "aiostreams" | "playlists" | "customize";

export function SettingsPanel({
  open,
  onClose,
  onConfigChanged,
  onReRunSetup,
}: {
  open: boolean;
  onClose: () => void;
  /** Called on close if playlists changed, so the device re-pulls its config. */
  onConfigChanged?: () => void;
  /** Open the phone-handoff setup flow (so sources can be added without typing
   * on the remote). */
  onReRunSetup?: () => void;
}) {
  const {
    prefs,
    setAccent,
    setUiScale,
    setLightMode,
    setHideNoInfoChannels,
    reset,
  } = usePreferences();
  const [tab, setTab] = useState<SettingsTab>("aiostreams");
  const dirty = useRef(false);

  // The panel is a focus boundary: arrow keys stay inside it while open, so the
  // remote can't wander onto the content behind. Focus lands on the active tab
  // when it opens and returns to the header button when it closes.
  const { ref: panelRef, focusKey: panelFocusKey } = useFocusable<HTMLDivElement>(
    {
      focusKey: "settings-panel",
      isFocusBoundary: true,
      saveLastFocusedChild: true,
      trackChildren: true,
    },
  );

  const close = () => {
    if (dirty.current) {
      dirty.current = false;
      onConfigChanged?.();
    }
    onClose();
    setFocus(SETTINGS_BTN_KEY);
  };

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setFocus(tabKey(tab)));
    return () => cancelAnimationFrame(id);
    // Only on open: focus the active tab. `tab` is intentionally not a dep —
    // re-focusing on every tab switch would yank focus off the tab row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    <FocusContext.Provider value={panelFocusKey}>
      <div className="settings-overlay" onClick={close}>
        <div
          className="settings-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
        >
          <FocusButton
            className="icon-btn settings-panel__close"
            focusKey="set-close"
            ariaLabel="Close settings"
            onPress={close}
          >
            <CloseIcon />
          </FocusButton>

          <div className="settings__inner">
            <h2 className="settings__title">Settings</h2>

            <nav className="settings__tabs" role="tablist" aria-label="Settings sections">
              {(["aiostreams", "playlists", "customize"] as const).map((t) => (
                <FocusButton
                  key={t}
                  focusKey={tabKey(t)}
                  className={"settings__tab" + (tab === t ? " settings__tab--active" : "")}
                  onPress={() => setTab(t)}
                >
                  {t === "aiostreams"
                    ? "AIOStreams"
                    : t === "playlists"
                      ? "Playlists"
                      : "Customize"}
                </FocusButton>
              ))}
            </nav>

            {tab === "aiostreams" && (
              <AioStreamsSettings
                onSaved={() => onConfigChanged?.()}
                onReRunSetup={onReRunSetup}
              />
            )}

            {tab === "playlists" && (
              <PlaylistsSettings
                onDirty={() => {
                  dirty.current = true;
                }}
                onReRunSetup={onReRunSetup}
              />
            )}

            {tab === "customize" && (
              <section className="settings__section">
                {/* Carousel sources */}
                <div className="settings__row settings__row--block">
                  <CarouselSources onSaved={() => onConfigChanged?.()} />
                </div>

                {/* Accent colour */}
                <div className="settings__row">
                  <div className="settings__row-label">
                    <span className="settings__row-title">Accent colour</span>
                    <span className="settings__row-desc">
                      Used for highlights, the live marker, and selection.
                    </span>
                  </div>
                  <div className="settings__control settings__swatches">
                    {ACCENT_PRESETS.map((c, i) => (
                      <FocusButton
                        key={c}
                        focusKey={`set-accent-${i}`}
                        ariaLabel={`Accent ${c}`}
                        className={
                          "swatch" +
                          (c.toLowerCase() === activeAccent ? " swatch--active" : "")
                        }
                        onPress={() => setAccent(c)}
                      >
                        <span
                          className="swatch__fill"
                          style={{ background: c }}
                          aria-hidden="true"
                        />
                      </FocusButton>
                    ))}
                    <AccentCustom
                      accent={prefs.accent}
                      isCustom={isCustomAccent}
                      onPick={setAccent}
                    />
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
                    <ScaleSlider
                      index={scaleIndex}
                      max={lastScale}
                      onScaleKey={onScaleKey}
                      onSetIndex={setScaleIndex}
                      onSetValue={setUiScale}
                    />
                  </div>
                </div>

                {/* Light mode */}
                <div className="settings__row">
                  <div className="settings__row-label">
                    <span className="settings__row-title">Light mode</span>
                    <span className="settings__row-desc">
                      Switch the interface to a light theme.
                    </span>
                  </div>
                  <div className="settings__control">
                    <FocusToggle
                      focusKey="set-light"
                      checked={prefs.lightMode}
                      onChange={setLightMode}
                      ariaLabel="Light mode"
                    />
                  </div>
                </div>

                {/* Hide channels with no info */}
                <div className="settings__row">
                  <div className="settings__row-label">
                    <span className="settings__row-title">
                      Hide channels with no info
                    </span>
                    <span className="settings__row-desc">
                      Skip live channels that have no programme information.
                    </span>
                  </div>
                  <div className="settings__control">
                    <FocusToggle
                      focusKey="set-hide"
                      checked={prefs.hideNoInfoChannels}
                      onChange={setHideNoInfoChannels}
                      ariaLabel="Hide channels with no info"
                    />
                  </div>
                </div>

                {/* Updates (desktop only) */}
                {isTauri() && <UpdatesRow />}
              </section>
            )}

            {tab === "customize" && (
              <div className="settings__footer">
                <FocusButton
                  className="btn"
                  focusKey="set-reset"
                  onPress={reset}
                >
                  Reset to defaults
                </FocusButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

/** The UI-scale slider as a single focusable: ◀/▶ step the value, ▲/▼ leave the
 * slider to the neighbouring rows. */
function ScaleSlider({
  index,
  max,
  onScaleKey,
  onSetIndex,
  onSetValue,
}: {
  index: number;
  max: number;
  onScaleKey: (e: React.KeyboardEvent) => void;
  onSetIndex: (i: number) => void;
  onSetValue: (v: number) => void;
}) {
  const { ref, focused } = useFocusable<HTMLDivElement>({
    focusKey: "set-scale",
    // ◀/▶ adjust and stay; ▲/▼ fall through to move focus off the slider.
    onArrowPress: (dir) => {
      if (dir === "left") {
        onSetIndex(index - 1);
        return false;
      }
      if (dir === "right") {
        onSetIndex(index + 1);
        return false;
      }
      return true;
    },
  });
  return (
    <div
      ref={ref}
      className={"scaleslider" + (focused ? " is-focused" : "")}
      role="slider"
      tabIndex={0}
      aria-label="UI scale"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={index}
      aria-valuetext={UI_SCALE_OPTIONS[index].label}
      onKeyDown={onScaleKey}
    >
      <div className="scaleslider__line" />
      <div
        className="scaleslider__fill"
        style={{ width: `calc((100% - 24px) * ${index / max})` }}
      />
      {UI_SCALE_OPTIONS.map((o, i) => (
        <button
          key={o.label}
          type="button"
          tabIndex={-1}
          className={
            "scalenotch" +
            (i <= index ? " is-filled" : "") +
            (i === index ? " is-active" : "")
          }
          style={{ left: `calc(12px + (100% - 24px) * ${i / max})` }}
          onClick={() => onSetValue(o.value)}
          aria-label={o.label}
        >
          <span className="scalenotch__bar" />
          <span className="scalenotch__label">{o.label}</span>
        </button>
      ))}
      <span
        className="scaleslider__thumb"
        style={{ left: `calc(12px + (100% - 24px) * ${index / max})` }}
        aria-hidden="true"
      />
    </div>
  );
}

/** Custom-accent picker: a focusable that opens the native colour input. */
function AccentCustom({
  accent,
  isCustom,
  onPick,
}: {
  accent: string;
  isCustom: boolean;
  onPick: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, focused } = useFocusable<HTMLLabelElement>({
    focusKey: "set-accent-custom",
    onEnterPress: () => inputRef.current?.click(),
  });
  return (
    <label
      ref={ref}
      className={
        "settings__custom-btn" +
        (isCustom ? " is-active" : "") +
        (focused ? " is-focused" : "")
      }
      title="Custom colour"
    >
      <PencilIcon size={15} />
      <span>Custom</span>
      <input
        ref={inputRef}
        type="color"
        value={accent}
        onChange={(e) => onPick(e.target.value)}
        aria-label="Custom accent colour"
      />
    </label>
  );
}

/** "Check for updates" row in the Customize tab — manual counterpart to the
 * launch banner. Shares the UpdaterProvider state, so a find here also lights
 * up the banner. */
function UpdatesRow() {
  const { status, version, error, check, install } = useUpdater();
  const offerInstall = status === "available" || status === "installing";
  const busy = status === "checking" || status === "installing";

  const desc =
    status === "available"
      ? `Version ${version} is ready to install.`
      : status === "installing"
        ? "Downloading and installing…"
        : status === "uptodate"
          ? "You're on the latest version."
          : status === "error"
            ? `Update check failed: ${error ?? "unknown error"}`
            : "Check for a new version of BlammyTV.";

  return (
    <div className="settings__row">
      <div className="settings__row-label">
        <span className="settings__row-title">Updates</span>
        <span className="settings__row-desc">{desc}</span>
      </div>
      <div className="settings__control">
        {offerInstall ? (
          <FocusButton
            className="btn btn--primary"
            focusKey="set-updates"
            disabled={busy}
            onPress={() => void install()}
          >
            {status === "installing" ? "Installing…" : "Install & restart"}
          </FocusButton>
        ) : (
          <FocusButton
            className="btn"
            focusKey="set-updates"
            disabled={busy}
            onPress={() => void check()}
          >
            {status === "checking" ? "Checking…" : "Check for updates"}
          </FocusButton>
        )}
      </div>
    </div>
  );
}
