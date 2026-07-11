import { useEffect, useRef, useState } from "react";
import { remove as removeStored } from "../../lib/storage";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { CheckIcon, EyeDropperIcon } from "../../ui/icons";
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
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "./startupTab";
import { savePlaylists } from "./playlists";
import { saveAioUrl, saveHeroSources } from "./aiostreams";

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

// Labels mirror the nav hierarchy (v0.3.37+): Discover is a Stream page,
// so the option says where it actually lands.
const STARTUP_TABS: Array<{ key: StartupTab; label: string }> = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream · Home" },
  { key: "discover", label: "Stream · Discover" },
];

/** The native screen eyedropper (Chromium/WebView2; absent elsewhere, so the
 * button only renders when supported). Not yet in TS's DOM lib. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
const eyeDropperCtor = (
  window as { EyeDropper?: new () => EyeDropperApi }
).EyeDropper;

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
  // Only "active" when the accent is the custom colour AND not also a preset —
  // otherwise a custom hex that happens to equal a preset lights up both swatches.
  const isCustomActive =
    custom !== "" &&
    accent === custom &&
    !ACCENT_PRESETS.some((p) => p.hex === accent);

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

  // Our own picker popover (the native one is unstylable OS chrome).
  const [pickerOpen, setPickerOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    // Capture-phase Esc so the popover closes before the modal would.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPickerOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !chipRef.current?.contains(t)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("mousedown", onDown);
    };
  }, [pickerOpen]);

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
   * dark theme, squircle corners, 100% scale, 12h clock, open on Live,
   * channel numbers shown. */
  const reset = () => {
    pick(ACCENT_PRESETS[0].hex);
    setCustom("");
    saveCustomAccent("");
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
            {/* Clicking applies the remembered custom color right away and
                opens our own picker popover (changes apply live). */}
            <button
              type="button"
              ref={chipRef}
              className={
                "accent-custom" +
                (isCustomActive ? " accent-custom--active" : "")
              }
              title="Custom"
              onClick={() => {
                if (custom) pick(custom);
                setPickerOpen((o) => !o);
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
            </button>
            {pickerOpen && (
              <div className="accent-popover" ref={popRef}>
                <HexColorPicker
                  color={custom || accent}
                  onChange={pickCustom}
                />
                <div className="accent-popover__row">
                  {eyeDropperCtor && (
                    <button
                      type="button"
                      className="accent-popover__dropper"
                      aria-label="Pick a color from the screen"
                      title="Pick from screen"
                      onClick={async () => {
                        try {
                          const { sRGBHex } = await new eyeDropperCtor().open();
                          pickCustom(sRGBHex);
                        } catch {
                          /* user cancelled the eyedropper */
                        }
                      }}
                    >
                      <EyeDropperIcon />
                    </button>
                  )}
                  <div className="accent-popover__hex">
                    <span className="accent-popover__hash">#</span>
                    <HexColorInput
                      color={custom || accent}
                      onChange={pickCustom}
                      aria-label="Custom accent hex value"
                    />
                  </div>
                </div>
              </div>
            )}
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

      </section>

      <UpdatesSection />

      <section className="settings-section">
        <div className="danger-zone">
          <h3 className="danger-zone__title">Danger Zone</h3>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Reset Appearance</h4>
              <p className="settings__section-note settings__section-note--dim">
                Accent, theme, corners, scale, clock, and startup tab back to
                defaults.
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
