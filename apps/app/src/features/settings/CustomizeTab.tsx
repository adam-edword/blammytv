import { useEffect, useRef, useState } from "react";
import { isTauri } from "../../lib/tauri";
import { remove as removeStored } from "../../lib/storage";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { CheckIcon, EyeDropperIcon } from "../../ui/icons";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import {
  ACCENT_PRESETS,
  applyAccent,
  applyAurora,
  isAuroraUnlocked,
  loadAccent,
  loadAccentStyle,
  loadCustomAccent,
  saveAccent,
  saveAccentStyle,
  saveCustomAccent,
  unlockAurora,
  type AccentStyle,
} from "./accent";
import { applyTheme, loadTheme, saveTheme, type Theme } from "./theme";
import {
  DEFAULT_PACK,
  INTENSE_PACKS,
  THEME_PACKS,
  applyThemePack,
  loadThemePack,
  saveThemePack,
  type ThemePackId,
  type ThemePackMeta,
} from "./themePacks";
import {
  activate,
  deactivate,
  licenseStatus,
  ownsPack,
  type LicenseStatus,
} from "./license";
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

type CustomizeSection = "general" | "theme" | "display";

// The pill IS the header now — no per-section h3 alongside these.
const SECTION_TABS: Array<{ key: CustomizeSection; label: string }> = [
  { key: "general", label: "General" },
  { key: "theme", label: "Theme" },
  { key: "display", label: "Display" },
];

/** The native screen eyedropper. NOT in the Tauri app: WebView2 exposes
 * the constructor (feature-detection passes) but open()'s pick mode can
 * never settle — input stays captured and the whole client freezes
 * (Bobby, v0.4.0). Browser/dev only until the platform verifies clean;
 * the popover keeps the full wheel + hex input either way. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
const eyeDropperCtor = isTauri()
  ? undefined
  : (window as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;

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
  // Which pill is showing — ephemeral, always opens back on General.
  const [sec, setSec] = useState<CustomizeSection>("general");

  const [accent, setAccent] = useState(loadAccent);
  // The custom slot keeps its color even while a preset is selected.
  const [custom, setCustom] = useState(loadCustomAccent);
  // Only "active" when the accent is the custom colour AND not also a preset —
  // otherwise a custom hex that happens to equal a preset lights up both swatches.
  const [accentStyle, setAccentStyle] =
    useState<AccentStyle>(loadAccentStyle);
  // The egg swatch: hidden until unlocked (spam-clicking Custom ×10;
  // aurora already running also counts — never lock out an active style).
  const [auroraUnlocked, setAuroraUnlocked] = useState(isAuroraUnlocked);
  const eggRef = useRef({ n: 0, at: 0 });
  const isCustomActive =
    custom !== "" &&
    accent === custom &&
    accentStyle !== "aurora" &&
    !ACCENT_PRESETS.some((p) => p.hex === accent);

  const pick = (hex: string) => {
    const value = hex.toLowerCase();
    setAccent(value);
    saveAccent(value);
    applyAccent(value); // also exits aurora
    setAccentStyle("flat");
    saveAccentStyle("flat");
  };
  const pickAurora = () => {
    setAccentStyle("aurora");
    saveAccentStyle("aurora");
    applyAurora();
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

  // Every pack is shown and previewable: the four free packs plus every
  // bundled intense pack. Ownership (ownsPack) only decides whether picking
  // one COMMITS or is an ephemeral preview — it never hides a card.
  // licenseStatus refreshes the lock badges + the "Themes Pass active" line
  // after activate/deactivate (ownsPack reads storage; a setState re-runs it).
  const [license, setLicense] = useState<LicenseStatus>(licenseStatus);
  const allPacks: ThemePackMeta[] = [
    ...THEME_PACKS,
    ...INTENSE_PACKS.filter((p) => !THEME_PACKS.some((b) => b.id === p.id)),
  ];

  // Seed from the live DOM (not storage) so the selected card stays in sync
  // with an in-flight preview if this tab remounts while Settings stays open.
  const [pack, setPack] = useState<ThemePackId>(
    () =>
      (document.documentElement.dataset.themePack as ThemePackId) ||
      DEFAULT_PACK,
  );
  const activePack = allPacks.find((p) => p.id === pack) ?? THEME_PACKS[0];
  const pickPack = (id: ThemePackId) => {
    // Always apply live — the full look (colors + bg + fonts + hovers).
    applyThemePack(id);
    setPack(id);
    const meta = allPacks.find((p) => p.id === id);
    // Dead-combo: a dark-only pack under the light theme forces dark.
    const forceDark = !!meta && !meta.supportsLight && theme === "light";
    if (ownsPack(id)) {
      // Commit — persists across Settings close and restarts.
      saveThemePack(id);
      if (forceDark) pickTheme("dark");
    } else if (forceDark) {
      // Preview only: reflect dark in the DOM WITHOUT persisting; the
      // SettingsModal close handler restores the committed pack + axis.
      applyTheme("dark");
    }
  };

  // Premium Themes: key input + Activate, or the licensed summary +
  // Remove. Reversible by re-pasting the key, so Remove needs no confirm.
  const [licenseInput, setLicenseInput] = useState("");
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const submitLicense = async () => {
    const key = licenseInput.trim();
    if (!key || activating) return;
    setActivating(true);
    setActivateMsg(null);
    const result = await activate(key);
    setActivating(false);
    if (result.ok) {
      setLicenseInput("");
      setLicense(licenseStatus());
      setActivateMsg({ ok: true, text: "Themes unlocked." });
    } else {
      setActivateMsg({ ok: false, text: result.message });
    }
  };

  const removeLicense = () => {
    deactivate();
    setLicense(licenseStatus());
    setActivateMsg(null);
    // deactivate() may have force-reset the active pack (dataset + storage)
    // if it was one of the ones this key licensed — pull the local state
    // back in sync with it.
    setPack(loadThemePack());
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
   * clock, open on Live, channel numbers shown. */
  const reset = () => {
    pick(ACCENT_PRESETS[0].hex);
    setCustom("");
    saveCustomAccent("");
    setPack(DEFAULT_PACK);
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
       * doesn't repeat across the Theme/Display tabs. */}
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

      {sec === "theme" && (
        <section className="settings-section">
          <h3 className="settings-section__list-title">Theme</h3>
          <p className="settings__section-note settings__section-note--dim">
            Swaps the whole palette in one tap — accent and light/dark still
            layer on top.
          </p>
          <div className="pack-row" role="radiogroup" aria-label="Theme pack">
            {allPacks.map((p) => {
              const locked = !!p.premium && !ownsPack(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === pack}
                  title={p.blurb}
                  data-pack={p.id}
                  className={
                    "pack-card" +
                    (p.id === pack ? " pack-card--active" : "") +
                    (locked ? " pack-card--locked" : "")
                  }
                  onClick={() => pickPack(p.id)}
                >
                  <span
                    className="pack-card__preview"
                    style={{ background: p.preview.bg }}
                  >
                    <span
                      className="pack-card__surface"
                      style={{ background: p.preview.surface }}
                    />
                    <span
                      className="pack-card__accent"
                      style={{ background: p.preview.accent }}
                    />
                    {locked && (
                      <span className="pack-card__lock">{p.price}</span>
                    )}
                  </span>
                  <span className="pack-card__name">{p.name}</span>
                </button>
              );
            })}
          </div>

          {/* Unlock affordance: shown only while an unowned premium pack is
              being PREVIEWED (picked but not owned). It reverts on Settings
              close (SettingsModal); this is the "keep it" path. */}
          {activePack.premium && !ownsPack(activePack.id) && (
            <div className="pack-preview-note" role="status">
              <span>
                Previewing <strong>{activePack.name}</strong> — reverts when you
                close Settings.
              </span>
              <a
                className="btn-primary pack-preview-note__buy"
                href={activePack.buyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Unlock to keep · {activePack.price}
              </a>
            </div>
          )}

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Premium Themes</h4>
              <p className="settings__section-note settings__section-note--dim">
                {license.active
                  ? license.pass
                    ? "Themes Pass active."
                    : `${license.installedCount} theme${
                        license.installedCount === 1 ? "" : "s"
                      } unlocked.`
                  : "Paste a license key to unlock paid theme packs."}
              </p>
            </div>
            <div className="license-control">
              {license.active ? (
                <button
                  type="button"
                  className="license-remove"
                  onClick={removeLicense}
                >
                  Remove license
                </button>
              ) : (
                <div className="license-form">
                  <input
                    className="settings-input license-input"
                    type="text"
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitLicense();
                    }}
                    placeholder="BTV-XXXX-XXXX-XXXX-XXXX"
                    spellCheck={false}
                    autoComplete="off"
                    data-1p-ignore=""
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={activating}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={activating || !licenseInput.trim()}
                    onClick={() => void submitLicense()}
                  >
                    {activating ? "Activating…" : "Activate"}
                  </button>
                </div>
              )}
              {/* Nested inside the SAME row as the input/button (not a
                * floating sibling) so the feedback reads as belonging to
                * the control that produced it. */}
              {activateMsg && (
                <p
                  className={
                    "license-status" +
                    (activateMsg.ok ? " license-status--ok" : "")
                  }
                  role={activateMsg.ok ? "status" : "alert"}
                >
                  {activateMsg.text}
                </p>
              )}
            </div>
          </div>

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
                  aria-checked={p.hex === accent && accentStyle !== "aurora"}
                  aria-label={p.name}
                  title={p.name}
                  className="accent-swatch"
                  style={swatchStyle(p.hex)}
                  onClick={() => pick(p.hex)}
                >
                  {p.hex === accent && accentStyle !== "aurora" && (
                    <CheckIcon className="accent-swatch__check" />
                  )}
                </button>
              ))}
              {/* Aurora: gradient surfaces where they fit, the violet
                * fallback hue everywhere thin (see accent.ts). EASTER
                * EGG — renders only once the Konami code has landed. */}
              {auroraUnlocked && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={accentStyle === "aurora"}
                  aria-label="Aurora"
                  title="Aurora (gradient)"
                  className="accent-swatch accent-swatch--aurora"
                  onClick={pickAurora}
                >
                  {accentStyle === "aurora" && (
                    <CheckIcon className="accent-swatch__check" />
                  )}
                </button>
              )}
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
                  // EASTER EGG: spam-clicking Custom 10 times (rapid-fire,
                  // <800ms between clicks) unlocks — and flips on — the
                  // Aurora gradient accent. The reveal is the whole app
                  // changing under the click.
                  const now = Date.now();
                  eggRef.current =
                    now - eggRef.current.at < 800
                      ? { n: eggRef.current.n + 1, at: now }
                      : { n: 1, at: now };
                  if (eggRef.current.n >= 10) {
                    eggRef.current = { n: 0, at: 0 };
                    unlockAurora();
                    setAuroraUnlocked(true);
                    pickAurora();
                    setPickerOpen(false);
                    return;
                  }
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
                {activePack.supportsLight
                  ? "Flip the whole app to a light palette."
                  : `${activePack.name} is dark-only.`}
              </p>
            </div>
            <div
              className={
                "toggle-disable-wrap" +
                (activePack.supportsLight ? "" : " toggle-disable-wrap--off")
              }
            >
              <Toggle
                on={theme === "light"}
                onChange={(on) => {
                  if (!activePack.supportsLight) return;
                  pickTheme(on ? "light" : "dark");
                }}
                label="Light theme"
              />
            </div>
          </div>
        </section>
      )}

      {sec === "display" && (
        <section className="settings-section">
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
