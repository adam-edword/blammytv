import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { EYEBROW } from "../../ui/eyebrow";
import { Segmented } from "../../ui/Segmented";
import { Toggle } from "../../ui/Toggle";
import { loadAioConn } from "../aiojf/conn";
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
import { AccentPicker } from "./AccentPicker";
import {
  clearAccent,
  saveAccent,
  saveCustomAccent,
} from "./accent";
import {
  THEME_TABS,
  applyThemePref,
  loadThemePref,
  saveThemePref,
  type ThemePref,
} from "./theme";
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
import { ConfirmButton } from "./ConfirmButton";
import { SignInNote } from "./SignInNote";
import { Hint } from "../../ui/Hint";

// CLOCK_TABS lives in clockFormat.ts: one list shared with onboarding.

/** The same Live TV / Stream split the Sources page uses. One mental
 * model: the app has two content worlds, and each page says its piece about
 * both. */
const WORLD_TABS = [
  { key: "stream", label: "Stream" },
  { key: "live", label: "Live TV" },
] as const;

// STARTUP_TABS lives in startupTab.ts: one list shared with onboarding.

/**
 * Appearance: how it looks. The accent, light or dark, the clock, and what
 * each world's screens show. What the app DOES when you press play is on the
 * Playback page, not here (the 0.8.0 filing rule); Reset Appearance is the
 * page's footer, behind the same two-press button as Clear All Login Info.
 */
// The accent picker lives here again (ROADMAP decision 1). Theme packs and
// the Themes Pass are parked in old/themes and come back later with new looks.
export function AppearancePage({ initialWorld }: { initialWorld?: "live" | "stream" }) {
  // Appearance (plan 022): Dark, Light, or Windows' own setting.
  const [theme, setTheme] = useState<ThemePref>(loadThemePref);
  const pickTheme = (next: ThemePref) => {
    setTheme(next);
    saveThemePref(next);
    applyThemePref(next);
  };

  const [startup, setStartup] = useState<StartupTab>(loadStartupTab);
  const pickStartup = (next: StartupTab) => {
    setStartup(next);
    saveStartupTab(next);
  };

  // Ephemeral, like Sources' pill: always opens on Stream, unless a find
  // from the palette names the pill its row is under.
  const [world, setWorld] = useState<"stream" | "live">(initialWorld ?? "stream");

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
  // no VOD overlay and no rows for them to govern. Read once per mount, and
  // a page mounts each time you arrive, so signing in on Sources reveals
  // them on your way here.
  const hasAddon = useRef(!!loadAioConn()).current;

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

  const [hero, setHero] = useState<boolean>(loadShowHero);

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

  /** Bumped by Reset so the accent picker remounts and re-reads storage:
   * its selection is its own state, and a reset that cleared storage while
   * the picker still ticked the old swatch would be lying. */
  const [accentKey, setAccentKey] = useState(0);

  /** Back to factory appearance: default accent (custom slot cleared),
   * dark appearance, 12h clock, channel numbers shown. Startup Tab is
   * NOT reset, even though it is displayed on this page: it decides where the
   * app OPENS, which is behaviour, and this button promises appearance. */
  const reset = () => {
    // The factory accent is NO accent since v0.9.57: --accent then resolves
    // from tokens.css (shadcn's primary) and keeps flipping with the theme,
    // which a stored hex cannot. Resetting to ACCENT_PRESETS[0] would have
    // put the brand red back on a button labelled "Reset Appearance".
    saveAccent("");
    clearAccent();
    saveCustomAccent("");
    setAccentKey((k) => k + 1);
    pickTheme("dark");
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
        * Interface rather than Appearance so it does not collide with the
        * Appearance PAGE one level up (or the Appearance row below). */}
      <h3 className={`settings__group ${EYEBROW}`}>Interface</h3>
      <section className="settings-section">
        {/* Stacked, not a row: nine swatches do not fit beside a label. */}
        <div className="customize-stack" data-setting="accent">
          <div>
            <h4 className="customize-row__title">Accent</h4>
            <p className="settings__section-note settings__section-note--dim">
              Buttons, toggles and highlights. Default follows light and dark.
            </p>
          </div>
          <AccentPicker key={accentKey} />
        </div>

        <div className="customize-row" data-setting="color-mode">
          <div>
            <h4 className="customize-row__title">Appearance</h4>
            <p className="settings__section-note settings__section-note--dim">
              Light, dark, or whatever Windows is set to.
            </p>
          </div>
          <Segmented label="Appearance" options={THEME_TABS} value={theme} onChange={pickTheme} />
        </div>

        <div className="customize-row" data-setting="startup-tab">
          <div>
            <h4 className="customize-row__title">Startup Tab</h4>
            <p className="settings__section-note settings__section-note--dim">
              Where the app opens.
            </p>
          </div>
          <Segmented label="Start on" options={STARTUP_TABS} value={startup} onChange={pickStartup} />
        </div>

        <div className="customize-row" data-setting="clock-format">
          <div>
            <h4 className="customize-row__title">Clock Format</h4>
            <p className="settings__section-note settings__section-note--dim">
              How the header clock reads.
            </p>
          </div>
          <Segmented label="Clock format" options={CLOCK_TABS} value={clock} onChange={pickClock} />
        </div>


      </section>

      {/* Per-world look, behind the same pill Sources uses. */}
      <h3 className={`settings__group ${EYEBROW}`}>Media</h3>
      <div className="customize-rail">
        <Segmented role="tabs" label="Media" options={WORLD_TABS} value={world} onChange={setWorld} />
      </div>

      {world === "stream" && !hasAddon && <SignInNote />}

      {/* One section, not four. Each control keeps its own label, but the
        * 21px block headings and the rule between every one of them made a
        * four-item panel read like four pages. ONE section for the whole
        * panel. Chip groups stack (too wide to sit beside a label); the rest
        * are normal rows. How Stream PLAYS is on the Playback page. */}
      {world === "stream" && hasAddon && (
        <section className="settings-section">
          {/* Above the sources picker, because it decides whether that
            * picker means anything: sources FOR a hero that is not there
            * is a setting with no effect, so it goes away with it. */}
          <div className="customize-row" data-setting="featured-carousel">
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

          <div className="customize-stack" data-setting="card-details">
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

          <div className="customize-stack" data-setting="player-overlay">
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

          <div className="customize-row" data-setting="row-size">
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
                <Hint label="Click to type an exact value">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  // Not `.rowcap__value`: that class also dresses the number
                  // INPUT beside it, which is not a Button and still needs
                  // its own type. The button half takes shadcn's instead.
                  className="rowcap__value--btn"
                  onClick={() => setCapDraft(String(rowCap))}
                >
                  {rowCap}
                </Button>
                </Hint>
              )}
            </div>
          </div>
        </section>
      )}

      {world === "live" && (
        <section className="settings-section">
          <div className="customize-row" data-setting="channel-numbers">
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

      {/* The page's footer: Reset Appearance stays with the things it
        * resets. */}
      <section className="settings-section">
        <div className="customize-row" data-setting="reset-appearance">
          <div>
            <h4 className="customize-row__title">Reset Appearance</h4>
            <p className="settings__section-note settings__section-note--dim">
              Accent, appearance and clock back to defaults.
            </p>
          </div>
          <ConfirmButton label="Reset" onConfirm={reset} />
        </div>
      </section>
    </>
  );
}
