import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ChipTabs } from "../../ui/ChipTabs";
import { Combobox, type ComboboxOption } from "../../ui/Combobox";
import { Toggle } from "../../ui/Toggle";
import { loadAioUrl } from "./aiostreams";
import { loadOneClickPlay, saveOneClickPlay } from "./oneClickPlay";
import { loadSourceFailover, saveSourceFailover } from "./failover";
import {
  AUTO,
  LANGUAGES,
  SUBS_OFF,
  loadAudioLang,
  loadSubLang,
  saveAudioLang,
  saveSubLang,
} from "./languagePrefs";
import {
  loadSkipBehavior,
  saveSkipBehavior,
  type SkipBehavior,
} from "./skipBehavior";
import { HeroSourcesSection } from "./HeroSourcesSection";
import { loadShowHero, saveShowHero } from "./showHero";
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
  clearAccent,
  saveAccent,
  saveAccentPairedBy,
  saveAccentStyle,
  saveCustomAccent,
} from "./accent";
import { applyTheme, saveTheme, type Theme } from "./theme";
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

const SCALE_TABS = UI_SCALES.map((s) => ({
  key: String(s),
  label: `${Math.round(s * 100)}%`,
}));

// CLOCK_TABS lives in clockFormat.ts — one list shared with onboarding.

/** The same Live TV / Stream split General's Sources uses. One mental
 * model: the app has two content worlds, and each tab says its piece about
 * both. */
const WORLD_TABS = [
  { key: "stream", label: "Stream" },
  { key: "live", label: "Live TV" },
] as const;

// STARTUP_TABS lives in startupTab.ts — one list shared with onboarding.

/**
 * The language pickers' options. Built once at module scope, not per render:
 * the list is 28 entries and never changes, and rebuilding it every render
 * would hand Combobox a new array identity each time for nothing.
 *
 * The code rides along as a search keyword so typing "es" finds Spanish as
 * well as typing "Spanish" does. That is the one thing the native <select>
 * did that a plain label list would have lost.
 */
const LANG_OPTIONS: ComboboxOption[] = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  keywords: [l.code],
}));
const AUDIO_OPTIONS: ComboboxOption[] = [
  { value: AUTO, label: "No preference" },
  ...LANG_OPTIONS,
];
const SUB_OPTIONS: ComboboxOption[] = [
  { value: AUTO, label: "No preference" },
  { value: SUBS_OFF, label: "Off" },
  ...LANG_OPTIONS,
];

// Themes are their own pop-out panel now — the old "Theme" pill is gone; the
// launcher at the top opens it. Accent + packs + Pass all live there.
export function CustomizeTab() {
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
  const [hero, setHero] = useState<boolean>(loadShowHero);
  const [oneClick, setOneClick] = useState<boolean>(loadOneClickPlay);
  const [failover, setFailover] = useState<boolean>(loadSourceFailover);
  const [skip, setSkip] = useState<SkipBehavior>(loadSkipBehavior);
  const [audioLang, setAudioLang] = useState<string>(loadAudioLang);
  const [subLang, setSubLang] = useState<string>(loadSubLang);

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
   * default theme pack, dark theme, 100% scale, 12h
   * clock, channel numbers shown. Startup Tab is NOT reset, even though it
   * is displayed on this tab: it decides where the app OPENS, which is
   * behaviour, and this button promises appearance. Accent + pack reset go
   * straight through the storage/apply seams (their live state lives in the
   * Themes panel, which isn't mounted here). */
  const reset = () => {
    // The factory accent is NO accent since v0.9.57: --accent then resolves
    // from tokens.css (shadcn's primary) and keeps flipping with the theme,
    // which a stored hex cannot. Resetting to ACCENT_PRESETS[0] would have
    // put the brand red back on a button labelled "Reset Appearance".
    saveAccent("");
    clearAccent();
    saveAccentStyle("flat");
    saveAccentPairedBy("");
    saveCustomAccent("");
    pickTheme("dark");
    pickScale(1);
    pickClock("12h");
    setChanNum(true);
    saveShowChannelNumber(true);
  };


  return (
    <>
      {/* The Themes launcher stood here. Parked in old/themes/ (v0.9.58),
          Adam's call: the pack engine was outranking the shadcn palette on
          every launch and it is easier to redesign without it in the way. */}
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
          {/* Above the sources picker, because it decides whether that
            * picker means anything: sources FOR a hero that is not there
            * is a setting with no effect, so it goes away with it. */}
          <div className="customize-row">
            <div>
              <h4 className="customize-row__title">Featured Carousel</h4>
              <p className="settings__section-note settings__section-note--dim">
                The big sliding banner at the top of Stream. Off removes it
                entirely and the rows start at the top.
              </p>
            </div>
            <Toggle
              on={hero}
              onChange={() => {
                const next = !hero;
                setHero(next);
                saveShowHero(next);
              }}
              label="Featured carousel"
            />
          </div>

          {hero && <HeroSourcesSection />}

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
                <Button
                  // Variant BY STATE, not a CSS override. The pressed look
                  // used to be `.meta-pick__chip[aria-pressed="true"]` in
                  // settings.css; since v0.9.54 that rule sets colours the
                  // variant also sets, and `utilities` outranks `app`, so it
                  // would never have painted again. shadcn's answer is to
                  // pick the variant, and the two it wants are exactly the
                  // two states: quiet when off, a filled surface when on.
                  variant={metaFields.includes(f.key) ? "secondary" : "ghost"}
                  key={f.key}
                  type="button"
                  // `hover:bg-muted` on the OFF chip, and it is not a taste
                  // call. shadcn's `secondary` and `ghost` read the same two
                  // tokens through this app's bridge (--color-secondary and
                  // --color-accent both resolve to --surface-raised), so
                  // ghost's own hover repaints an off chip in exactly the on
                  // colour. In a row of toggles that is a lie. --color-muted
                  // is the next surface down and keeps the two apart.
                  className={
                    "meta-pick__chip" +
                    (metaFields.includes(f.key) ? "" : " hover:bg-muted")
                  }
                  aria-pressed={metaFields.includes(f.key)}
                  onClick={() => toggleMeta(f.key)}
                >
                  {f.label}
                </Button>
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
                <Button
                  variant={
                    overlayFields.includes(f.key) ? "secondary" : "ghost"
                  }
                  key={f.key}
                  type="button"
                  className={
                    "meta-pick__chip" +
                    (overlayFields.includes(f.key) ? "" : " hover:bg-muted")
                  }
                  aria-pressed={overlayFields.includes(f.key)}
                  onClick={() => toggleOverlay(f.key)}
                >
                  {f.label}
                </Button>
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
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  // Not `.rowcap__value`: that class also dresses the number
                  // INPUT beside it, which is not a Button and still needs
                  // its own type. The button half takes shadcn's instead.
                  className="rowcap__value--btn"
                  title="Click to type an exact value"
                  onClick={() => setCapDraft(String(rowCap))}
                >
                  {rowCap}
                </Button>
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
              <h4 className="customize-row__title">Preferred Language</h4>
              <p className="settings__section-note settings__section-note--dim">
                Every stream tries to load these. A track you pick by hand on a
                particular show still wins for that show, and anything the
                stream doesn&rsquo;t carry is left alone.
              </p>
            </div>
            <div className="customize-langs">
              <div className="customize-lang">
                <span>Audio</span>
                <Combobox
                  className="customize-lang__select w-44"
                  contentClassName="w-56"
                  ariaLabel="Preferred audio language"
                  options={AUDIO_OPTIONS}
                  value={audioLang}
                  searchPlaceholder="Search languages…"
                  emptyText="No language found."
                  onChange={(v) => {
                    setAudioLang(v);
                    saveAudioLang(v);
                  }}
                />
              </div>
              <div className="customize-lang">
                <span>Subtitles</span>
                <Combobox
                  className="customize-lang__select w-44"
                  contentClassName="w-56"
                  ariaLabel="Preferred subtitle language"
                  options={SUB_OPTIONS}
                  value={subLang}
                  searchPlaceholder="Search languages…"
                  emptyText="No language found."
                  onChange={(v) => {
                    setSubLang(v);
                    saveSubLang(v);
                  }}
                />
              </div>
            </div>
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
                Accent, theme, scale, and clock back to defaults.
              </p>
            </div>
            <Button
              variant="destructive"
              type="button"
              className="btn-danger"
              onClick={reset}
            >
              Reset
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
