import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorInput, HexColorPicker } from "react-colorful";
import {
  CheckIcon,
  CloseIcon,
  ExternalLinkIcon,
  EyeDropperIcon,
  HeartIcon,
  MoonIcon,
  SunIcon,
} from "../../ui/icons";
import { isTauri, openExternal } from "../../lib/tauri";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  applyAccent,
  applyAurora,
  isAuroraUnlocked,
  loadAccent,
  loadAccentPairedBy,
  loadAccentStyle,
  loadCustomAccent,
  saveAccent,
  saveAccentPairedBy,
  saveAccentStyle,
  saveCustomAccent,
  unlockAurora,
  type AccentStyle,
} from "./accent";
import { applyTheme, loadTheme, saveTheme, type Theme } from "./theme";
import {
  CLASSIC_PACK,
  INTENSE_PACKS,
  THEME_PACKS,
  THEMES_PASS,
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

/** Native screen eyedropper — browser/dev only (it freezes WebView2; see
 * CustomizeTab). The popover keeps the wheel + hex input either way. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
const eyeDropperCtor = isTauri()
  ? undefined
  : (window as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;

/** Swatch look: the color's 16% surface tint as fill, the pure color as the
 * border — the accent family's recipe (--mix-base tracks the theme). */
function swatchStyle(hex: string) {
  return {
    background: `color-mix(in srgb, ${hex} 16%, var(--mix-base))`,
    borderColor: hex,
  };
}

/**
 * The standalone Themes panel (Figma 302:1397). Popped out of Settings — it
 * owns the whole appearance-theme surface that used to live in the Customize →
 * Theme sub-tab: the accent picker, the Free/Premium theme shelves, and the
 * Themes Pass block. Opening it closes Settings; closing it returns to the app.
 *
 * Preview/commit/revert boundary lives here now (moved from SettingsModal):
 * picking a pack applies the full look live, but only COMMITS (writes storage)
 * the packs this machine owns. An unowned pick is an ephemeral preview that
 * this component's unmount cleanup snaps back to the committed baseline.
 */
export function ThemesModal({ onClose }: { onClose: () => void }) {
  // ---- accent ------------------------------------------------------------
  const [accent, setAccent] = useState(loadAccent);
  const [custom, setCustom] = useState(loadCustomAccent);
  const [accentStyle, setAccentStyle] = useState<AccentStyle>(loadAccentStyle);
  const [auroraUnlocked, setAuroraUnlocked] = useState(isAuroraUnlocked);
  const eggRef = useRef({ n: 0, at: 0 });
  const isCustomActive =
    custom !== "" &&
    accent === custom &&
    accentStyle !== "aurora" &&
    !ACCENT_PRESETS.some((p) => p.hex === accent);

  // True while an UNOWNED pack's paired accent is applied to the DOM only
  // (nothing saved) — so picking an unpaired pack or closing the modal knows
  // to snap the accent back to the persisted one.
  const livePaired = useRef(false);
  const restorePersistedAccent = () => {
    if (loadAccentStyle() === "aurora") applyAurora();
    else applyAccent(loadAccent());
    setAccent(loadAccent());
    setAccentStyle(loadAccentStyle());
    livePaired.current = false;
  };

  const pick = (hex: string) => {
    const value = hex.toLowerCase();
    setAccent(value);
    saveAccent(value);
    applyAccent(value); // also exits aurora
    setAccentStyle("flat");
    saveAccentStyle("flat");
    // A hand-picked accent always wins — end any pack pairing.
    saveAccentPairedBy("");
    livePaired.current = false;
  };
  const pickAurora = () => {
    setAccentStyle("aurora");
    saveAccentStyle("aurora");
    applyAurora();
    saveAccentPairedBy("");
    livePaired.current = false;
  };
  const pickCustom = (hex: string) => {
    const value = hex.toLowerCase();
    setCustom(value);
    saveCustomAccent(value);
    pick(value);
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
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

  // ---- theme packs -------------------------------------------------------
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const pickTheme = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };

  // licenseStatus refreshes lock badges + the Pass line after activate/remove.
  const [license, setLicense] = useState<LicenseStatus>(licenseStatus);

  // Every renderable pack, for id → meta lookups (includes the passOnly
  // Supporter, which the Pass block renders on its own).
  const allPacks: ThemePackMeta[] = [...THEME_PACKS, ...INTENSE_PACKS];
  const freePacks = THEME_PACKS;
  const premiumPacks = INTENSE_PACKS.filter((p) => !p.passOnly);
  const supporter = INTENSE_PACKS.find((p) => p.passOnly);

  // No dataset attribute = classic (the attribute-less pack), NOT the
  // default — BlammyTV/slate is the default and always sets the attribute.
  const [pack, setPack] = useState<ThemePackId>(
    () =>
      (document.documentElement.dataset.themePack as ThemePackId) ||
      CLASSIC_PACK,
  );
  const activePack = allPacks.find((p) => p.id === pack) ?? THEME_PACKS[0];
  const previewing = activePack.premium && !ownsPack(activePack.id);

  const pickPack = (id: ThemePackId) => {
    applyThemePack(id); // always preview the full look live
    setPack(id);
    const meta = allPacks.find((p) => p.id === id);
    const forceDark = !!meta && !meta.supportsLight && theme === "light";
    const owns = ownsPack(id);
    if (owns) {
      saveThemePack(id); // commit
      if (forceDark) pickTheme("dark");
    } else if (forceDark) {
      applyTheme("dark"); // preview dark WITHOUT persisting; unmount reverts
    }

    // Accent pairing (option 3): a pack may SUGGEST an accent, applied only
    // while the user is on the default red or a previous pack's pairing — a
    // hand-picked accent is never touched. Owned picks persist the pairing;
    // unowned previews apply it to the DOM only (unmount snaps back).
    const pairable =
      loadAccentStyle() !== "aurora" &&
      (loadAccent() === DEFAULT_ACCENT || loadAccentPairedBy() !== "");
    if (meta?.pairedAccent && pairable) {
      applyAccent(meta.pairedAccent);
      setAccent(meta.pairedAccent);
      setAccentStyle("flat");
      if (owns) {
        saveAccent(meta.pairedAccent);
        saveAccentStyle("flat");
        saveAccentPairedBy(id);
        livePaired.current = false;
      } else {
        livePaired.current = true;
      }
    } else if (!meta?.pairedAccent) {
      if (owns && loadAccentPairedBy() !== "") {
        // Committed move onto an unpaired pack: the pairing ends, back to
        // the default accent.
        saveAccent(DEFAULT_ACCENT);
        saveAccentPairedBy("");
        applyAccent(DEFAULT_ACCENT);
        setAccent(DEFAULT_ACCENT);
        livePaired.current = false;
      } else if (livePaired.current) {
        // Preview moved off the paired pack: un-apply the live-only accent.
        restorePersistedAccent();
      }
    }
  };

  // ---- license activation ------------------------------------------------
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
    // deactivate() may have force-reset a now-unowned active pack — resync.
    setPack(loadThemePack());
  };

  // ---- modal lifecycle: Esc closes; unmount reverts a live preview -------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      const persisted = loadThemePack();
      const live =
        (document.documentElement.dataset.themePack as string) ?? CLASSIC_PACK;
      if (live !== persisted) {
        applyThemePack(persisted);
        applyTheme(loadTheme());
      }
      // A live-only paired accent (unowned preview) reverts with the pack.
      if (loadAccentStyle() === "aurora") applyAurora();
      else applyAccent(loadAccent());
    };
  }, []);

  const freeCard = (p: ThemePackMeta) => (
    <button
      key={p.id}
      type="button"
      role="radio"
      aria-checked={p.id === pack}
      title={p.blurb}
      data-pack={p.id}
      className={"tcard tcard--free" + (p.id === pack ? " tcard--active" : "")}
      onClick={() => pickPack(p.id)}
    >
      <span
        className="tcard__art"
        style={{
          // A pack with a light axis shows both halves on a hard diagonal
          // split (the mock's Mono/Paper cards); dark-only packs stay flat.
          background: p.preview.lightBg
            ? `linear-gradient(125deg, ${p.preview.bg} 50%, ${p.preview.lightBg} 50%)`
            : p.preview.bg,
        }}
      >
        <span
          className="tcard__chip"
          style={{ background: p.preview.surface }}
        />
      </span>
      <span className="tcard__name">{p.name}</span>
    </button>
  );

  const premiumCard = (p: ThemePackMeta) => {
    const owned = ownsPack(p.id);
    return (
      <button
        key={p.id}
        type="button"
        role="radio"
        aria-checked={p.id === pack}
        title={p.blurb}
        data-pack={p.id}
        className={
          "tcard tcard--premium" +
          (p.id === pack ? " tcard--active" : "") +
          (owned ? "" : " tcard--locked")
        }
        onClick={() => pickPack(p.id)}
      >
        <span
          className="tcard__art tcard__art--premium"
          data-pack-art={p.id}
          // backgroundColor (not the shorthand) so the per-pack art skins in
          // themes.css can layer a background-image over it.
          style={{ backgroundColor: p.preview.bg }}
        >
          <span
            className="tcard__chip"
            style={{ background: p.preview.surface }}
          />
        </span>
        <span className="tcard__foot">
          <span className="tcard__name">{p.name}</span>
          {!owned && p.buyUrl && (
            <a
              className="tcard__price"
              href={p.buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // The webview swallows target=_blank — hand off to the
                // system browser (keep the href for semantics/tests).
                e.stopPropagation();
                e.preventDefault();
                if (p.buyUrl) openExternal(p.buyUrl);
              }}
            >
              {p.price} <ExternalLinkIcon size={15} />
            </a>
          )}
        </span>
      </button>
    );
  };

  return createPortal(
    <div className="modal-backdrop modal-backdrop--center" onClick={onClose}>
      <section
        className="settings themes-modal"
        role="dialog"
        aria-label="Themes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="themes-modal__header">
          <span className="themes-modal__spacer" aria-hidden="true" />
          <h2 className="themes-modal__title">Themes</h2>
          <button
            type="button"
            className="settings__close"
            aria-label="Close themes"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        {/* ---- Topline: Accent (left) + Theme Style (right) ---- */}
        <div className="themes-topline">
        <section className="themes-accent">
          <h3 className="themes-accent__title">Accent</h3>
          <p className="settings__section-note settings__section-note--dim">
            Used for highlights, toggles, and buttons across the app.
          </p>
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
            <button
              type="button"
              ref={chipRef}
              className={
                "accent-custom" +
                (isCustomActive ? " accent-custom--active" : "")
              }
              title="Custom"
              onClick={() => {
                // EASTER EGG: spam Custom ×10 (<800ms apart) unlocks Aurora.
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
        </section>

        <section className="themes-style">
          <h3 className="themes-accent__title">Theme Style</h3>
          <p className="settings__section-note settings__section-note--dim">
            Light or Dark mode
          </p>
          <div
            className="theme-pill"
            role="radiogroup"
            aria-label="Theme style"
            title={
              activePack.supportsLight
                ? undefined
                : `${activePack.name} is dark-only.`
            }
          >
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              aria-label="Light mode"
              className={
                "theme-pill__seg" +
                (theme === "light" ? " theme-pill__seg--active" : "") +
                (activePack.supportsLight ? "" : " theme-pill__seg--off")
              }
              onClick={() => {
                if (activePack.supportsLight) pickTheme("light");
              }}
            >
              <SunIcon size={17} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              aria-label="Dark mode"
              className={
                "theme-pill__seg" +
                (theme === "dark" ? " theme-pill__seg--active" : "")
              }
              onClick={() => pickTheme("dark")}
            >
              <MoonIcon size={15} />
            </button>
          </div>
        </section>
        </div>

        <hr className="themes-divider" />

        {/* ---- Free ---- */}
        <section className="themes-shelf">
          <h3 className="themes-shelf__label">Free</h3>
          <div
            className="themes-shelf__row"
            role="radiogroup"
            aria-label="Free themes"
          >
            {freePacks.map(freeCard)}
          </div>
        </section>

        <hr className="themes-divider" />

        {/* ---- Premium ---- */}
        <section className="themes-shelf">
          <h3 className="themes-shelf__label">Premium</h3>
          <div
            className="themes-shelf__row"
            role="radiogroup"
            aria-label="Premium themes"
          >
            {premiumPacks.map(premiumCard)}
          </div>
        </section>

        {/* Unlock affordance for a previewed, buyable premium pack. */}
        {previewing && activePack.buyUrl && (
          <div className="pack-preview-note" role="status">
            <span>
              Previewing <strong>{activePack.name}</strong> — reverts when you
              close Themes.
            </span>
            <a
              className="btn-primary pack-preview-note__buy"
              href={activePack.buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                if (activePack.buyUrl) openExternal(activePack.buyUrl);
              }}
            >
              Unlock to keep · {activePack.price}
            </a>
          </div>
        )}

        <hr className="themes-divider" />

        {/* ---- Themes Pass ---- */}
        <section className="themes-pass">
          {license.pass ? (
            /* Pass active: the pitch becomes a thank-you. */
            <div className="themes-pass__info">
              <h3 className="themes-pass__title">
                Thank You{" "}
                <HeartIcon size={34} className="themes-pass__heart" />
              </h3>
              <p className="themes-pass__blurb">
                Your Themes Pass unlocks every theme on this device — including
                the Supporters theme, made just for you.
              </p>
              <p className="themes-pass__fine">
                Themes Pass active · Lasts Forever
              </p>
            </div>
          ) : (
            <div className="themes-pass__info">
              <h3 className="themes-pass__title">Themes Pass</h3>
              <p className="themes-pass__blurb">
                Unlocks every theme, plus a special supporters theme!
              </p>
              <p className="themes-pass__price">{THEMES_PASS.price}</p>
              <a
                className="themes-pass__cta"
                href={THEMES_PASS.buyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openExternal(THEMES_PASS.buyUrl);
                }}
              >
                Get the Themes Pass
              </a>
              <p className="themes-pass__fine">
                Lasts Forever · One Time Purchase · 3 Devices
              </p>
            </div>
          )}

          {supporter && (
            <button
              type="button"
              role="radio"
              aria-checked={pack === supporter.id}
              title={supporter.blurb}
              data-pack={supporter.id}
              className={
                "pass-supporter" +
                (pack === supporter.id ? " pass-supporter--active" : "")
              }
              onClick={() => pickPack(supporter.id)}
            >
              <span className="pass-supporter__chip" />
              <span className="pass-supporter__mini" />
              <span className="pass-supporter__foot">
                <span className="pass-supporter__name">
                  Supporters
                  <HeartIcon size={18} className="pass-supporter__heart" />
                </span>
                {!license.pass && (
                  <span className="pass-supporter__price">
                    {THEMES_PASS.price}*
                  </span>
                )}
              </span>
            </button>
          )}
        </section>

        {/* ---- License activation (below the Pass block) ---- */}
        <div className="themes-license">
          {license.active ? (
            <div className="themes-license__active">
              <span className="settings__section-note settings__section-note--dim">
                {license.pass
                  ? "Themes Pass active."
                  : `${license.installedCount} theme${
                      license.installedCount === 1 ? "" : "s"
                    } unlocked.`}
              </span>
              <button
                type="button"
                className="license-remove"
                onClick={removeLicense}
              >
                Remove license
              </button>
            </div>
          ) : (
            <>
              <span className="settings__section-note settings__section-note--dim">
                Already have a key?
              </span>
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
            </>
          )}
          {activateMsg && (
            <p
              className={
                "license-status" + (activateMsg.ok ? " license-status--ok" : "")
              }
              role={activateMsg.ok ? "status" : "alert"}
            >
              {activateMsg.text}
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
