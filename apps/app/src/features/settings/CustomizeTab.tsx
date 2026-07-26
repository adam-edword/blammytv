import { useRef, useState } from "react";
import { ChevronIcon } from "../../ui/icons";
import { ChipTabs } from "../../ui/ChipTabs";
import { Toggle } from "../../ui/Toggle";
import { loadAioUrl } from "./aiostreams";
import { loadOneClickPlay, saveOneClickPlay } from "./oneClickPlay";
import { loadSourceFailover, saveSourceFailover } from "./failover";
import {
  loadSkipBehavior,
  saveSkipBehavior,
  type SkipBehavior,
} from "./skipBehavior";
import { HeroSourcesSection } from "./HeroSourcesSection";
import {
  STARTUP_TABS,
  loadStartupTab,
  saveStartupTab,
  type StartupTab,
} from "./startupTab";
import {
  CARD_META_FIELDS,
  loadCardMeta,
  saveCardMeta,
  type CardMetaField,
} from "./cardMeta";
import {
  OVERLAY_META_FIELDS,
  loadOverlayMeta,
  saveOverlayMeta,
  type OverlayMetaField,
} from "./overlayMeta";
import { ROW_CAP_MAX, ROW_CAP_MIN, loadRowCap, saveRowCap } from "./rowCap";
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

/** The same Live TV / Stream split General's Sources uses. One mental
 * model: the app has two content worlds, and each tab says its piece about
 * both. */
const WORLD_TABS = [
  { key: "stream", label: "Stream" },
  { key: "live", label: "Live TV" },
] as const;

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

  const [startup, setStartup] = useState<StartupTab>(loadStartupTab);
  const pickStartup = (next: StartupTab) => {
    setStartup(next);
    saveStartupTab(next);
  };

  // Ephemeral, like General's Sources: always opens on Stream.
  const [world, setWorld] = useState<"stream" | "live">("stream");

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

  // What the catalog surfaces SHOW, moved off the AIOStreams tab: these
  // describe the app's appearance, not the connection that feeds it. Still
  // gated on a configured manifest, because with none there are no cards,
  // no VOD overlay and no rows for them to govern. Read once per mount, so
  // adding a manifest reveals them the next time Settings opens.
  const hasAddon = useRef(loadAioUrl() !== "").current;

  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  const toggleMeta = (key: CardMetaField) => {
    setMetaFields(
      saveCardMeta(
        metaFields.includes(key)
          ? metaFields.filter((k) => k !== key)
          : [...metaFields, key],
      ),
    );
  };

  const [overlayFields, setOverlayFields] =
    useState<OverlayMetaField[]>(loadOverlayMeta);
  const toggleOverlay = (key: OverlayMetaField) => {
    setOverlayFields(
      saveOverlayMeta(
        overlayFields.includes(key)
          ? overlayFields.filter((k) => k !== key)
          : [...overlayFields, key],
      ),
    );
  };

  // Playback behaviour for the Stream side. It lives with the rest of the
  // Stream world rather than in General: everything that belongs to ONE
  // side of the app is in one place, and hunting across two tabs to tune
  // Stream was the thing this whole rail is meant to stop.
  const [oneClick, setOneClick] = useState<boolean>(loadOneClickPlay);
  const [failover, setFailover] = useState<boolean>(loadSourceFailover);
  const [skip, setSkip] = useState<SkipBehavior>(loadSkipBehavior);

  // The slider steps by 5; clicking the number swaps it for a type-in field.
  const [rowCap, setRowCap] = useState<number>(loadRowCap);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const commitCap = () => {
    if (capDraft !== null) {
      const n = Number(capDraft);
      if (Number.isFinite(n) && capDraft.trim() !== "")
        setRowCap(saveRowCap(n)); // clamps to 10-100
    }
    setCapDraft(null);
  };

  /** Back to factory appearance: default accent (custom slot cleared),
   * default theme pack, dark theme, squircle corners, 100% scale, 12h
   * clock, channel numbers shown. Startup Tab is NOT reset, even though it
   * is displayed on this tab: it decides where the app OPENS, which is
   * behaviour, and this button promises appearance. Accent + pack reset go
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


      {/* Applies everywhere, whichever side of the app you are on. Named
        * Interface rather than General so it does not collide with the
        * General TAB one level up. */}
      <h3 className="settings__group">Interface</h3>
      <section className="settings-section">
        <div className="customize-row">
          <div>
            <h4 className="customize-row__title">Startup Tab</h4>
            <p className="settings__section-note settings__section-note--dim">
              Where the app opens.
            </p>
          </div>
          <ChipTabs tabs={STARTUP_TABS} active={startup} onChange={pickStartup} />
        </div>

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
          <ChipTabs tabs={CORNER_TABS} active={corners} onChange={pickCorners} />
        </div>
      </section>

      {/* Per-world look, behind the same pill General's Sources uses. */}
      <h3 className="settings__group">Media</h3>
      <div className="customize-rail">
        <ChipTabs tabs={WORLD_TABS} active={world} onChange={setWorld} />
      </div>

      {world === "stream" && !hasAddon && (
        <section className="settings-section">
          <p className="settings__section-note settings__section-note--dim">
            Connect an AIOStreams manifest under General &rarr; Sources and
            these appear.
          </p>
        </section>
      )}

      {/* One section, not five. Each control keeps its own label, but the
        * 21px block headings and the rule between every one of them made a
        * seven-item panel read like seven pages. ONE section for the whole
        * panel: look first, then playback, with no rule between them —
        * they are one list of Stream settings, not two topics. Chip groups
        * stack (too wide to sit beside a label); the rest are normal rows. */}
      {world === "stream" && hasAddon && (
        <section className="settings-section">
          <HeroSourcesSection />

          <div className="customize-stack">
            <div>
              <h4 className="customize-row__title">Card Details</h4>
              <p className="settings__section-note settings__section-note--dim">
                Under a card&rsquo;s title. Runtime shows only where the catalog
                provides it.
              </p>
            </div>
            <div className="meta-pick" role="group" aria-label="Card details">
              {CARD_META_FIELDS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="meta-pick__chip"
                  aria-pressed={metaFields.includes(f.key)}
                  onClick={() => toggleMeta(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="customize-stack">
            <div>
              <h4 className="customize-row__title">Player Overlay</h4>
              <p className="settings__section-note settings__section-note--dim">
                Beside the title art during playback.
              </p>
            </div>
            <div className="meta-pick" role="group" aria-label="Player overlay">
              {OVERLAY_META_FIELDS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="meta-pick__chip"
                  aria-pressed={overlayFields.includes(f.key)}
                  onClick={() => toggleOverlay(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Catalog Row Size</h4>
              <p className="settings__section-note settings__section-note--dim">
                Titles per row. A higher cap means longer loads.
              </p>
            </div>
            <div className="rowcap">
              <input
                className="rowcap__slider"
                type="range"
                min={ROW_CAP_MIN}
                max={ROW_CAP_MAX}
                step={5}
                value={rowCap}
                aria-label="Titles per row"
                onChange={(e) => setRowCap(saveRowCap(Number(e.target.value)))}
              />
              {capDraft !== null ? (
                <input
                  className="rowcap__value rowcap__value--edit"
                  type="number"
                  min={ROW_CAP_MIN}
                  max={ROW_CAP_MAX}
                  value={capDraft}
                  autoFocus
                  aria-label="Titles per row (exact)"
                  onChange={(e) => setCapDraft(e.target.value)}
                  onBlur={commitCap}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCap();
                    if (e.key === "Escape") setCapDraft(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="rowcap__value rowcap__value--btn"
                  title="Click to type an exact value"
                  onClick={() => setCapDraft(String(rowCap))}
                >
                  {rowCap}
                </button>
              )}
            </div>
          </div>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">One-Click Play Movies</h4>
              <p className="settings__section-note settings__section-note--dim">
                Clicking a movie plays the best cached source right away.
                Uncached is never auto-played.
              </p>
            </div>
            <Toggle
              on={oneClick}
              onChange={() => {
                const next = !oneClick;
                setOneClick(next);
                saveOneClickPlay(next);
              }}
              label="One-click play"
            />
          </div>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Auto Source Failover</h4>
              <p className="settings__section-note settings__section-note--dim">
                A source dying mid-play jumps to the next cached one. Off shows
                a button instead.
              </p>
            </div>
            <Toggle
              on={failover}
              onChange={() => {
                const next = !failover;
                setFailover(next);
                saveSourceFailover(next);
              }}
              label="Auto source failover"
            />
          </div>

          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Skip Behavior</h4>
              <p className="settings__section-note settings__section-note--dim">
                The Skip Intro/Recap/Credits button, from the file&rsquo;s
                chapters. Combine merges credits and preview into one jump.
              </p>
            </div>
            <ChipTabs
              tabs={[
                { key: "hidden", label: "Hidden" },
                { key: "normal", label: "Normal" },
                { key: "combine", label: "Combine Credits & Preview" },
              ]}
              active={skip}
              onChange={(k: SkipBehavior) => {
                setSkip(k);
                saveSkipBehavior(k);
              }}
            />
          </div>
        </section>
      )}

      {world === "live" && (
        <section className="settings-section">
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
