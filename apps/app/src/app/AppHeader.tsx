import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccountIcon, SearchIcon, SettingsIcon } from "../ui/icons";
import { ChipTabs } from "../ui/ChipTabs";
import { currentZoom } from "../features/settings/uiScale";
import {
  onSearchQueryChange,
  setSearchQuery,
} from "../features/discover/searchQuery";
import { UpdateChip } from "./UpdateChip";
import { formatClock } from "../lib/time";
import { APP_VERSION } from "../lib/version";
import {
  loadClockFormat,
  onClockFormatChange,
} from "../features/settings/clockFormat";

/** The app's two SIDES. "Stream" in the top nav is a section header,
 * not a page — the pill rail below picks the actual Stream page. */
export type Section = "live" | "stream";
/** The Stream section's pages (the pill rail). Adding one = a new entry
 * here + in RAIL + a screen in App's switch — nothing else. */
export type StreamTab = "home" | "discover" | "mylist";

const RAIL: Array<{ key: StreamTab; label: string }> = [
  { key: "home", label: "Home" },
  { key: "discover", label: "Discover" },
  { key: "mylist", label: "My List" },
];

/** Live clock, minute-accurate (the header shows no seconds). Follows the
 * 12h/24h preference immediately when it changes in Settings. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  const [format, setFormat] = useState(loadClockFormat);
  useEffect(() => {
    // Tick once per minute, re-aligned to the wall-clock minute boundary (the
    // header shows no seconds) — not 60 re-renders/min for a string that only
    // changes once a minute.
    let id: number;
    const schedule = () =>
      window.setTimeout(() => {
        setNow(new Date());
        id = schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    id = schedule();
    const off = onClockFormatChange(setFormat);
    return () => {
      window.clearTimeout(id);
      off();
    };
  }, []);
  return formatClock(now, format);
}

export function AppHeader({
  section,
  streamTab,
  onSection,
  onStreamTab,
  onOpenSettings,
}: {
  section: Section;
  streamTab: StreamTab;
  onSection: (s: Section) => void;
  onStreamTab: (t: StreamTab) => void;
  onOpenSettings: () => void;
}) {
  const clock = useClock();
  // Controlled mirror of the shared search store (the store is the truth
  // DiscoverScreen renders from; local state keeps the input snappy).
  const [query, setQuery] = useState("");
  // Mirror store-side clears too (e.g. a genre pill hand-off clears the
  // search) — otherwise the input shows stale text over browse results.
  useEffect(() => onSearchQueryChange(setQuery), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // While the search input is focused the rail's thumb parks on the
  // search chip (thumbKey) — the thumb tracks where your INPUT goes;
  // `streamTab` stays the truth of which page is showing.
  const [searchOpen, setSearchOpen] = useState(false);
  // Fit the floating input to the space actually available before the
  // right-side controls — 240px is a ceiling, not a promise. At 125% UI
  // scale on a narrow window the fixed width overran the settings icon
  // by 200+px. gBCR is visual (zoom-included) px; ÷zoom converts back
  // to the CSS px the width style is written in (see uiScale.ts).
  const searchChipRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!searchOpen) return;
    const chip = searchChipRef.current;
    const fit = () => {
      const right = document.querySelector(".header__right");
      if (!chip || !right) return;
      const gap =
        (right.getBoundingClientRect().left -
          chip.getBoundingClientRect().right) /
        currentZoom();
      const w = Math.max(48, Math.min(240, gap - 18));
      chip.style.setProperty("--search-w", `${w}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      // Drop the measured width on blur: the blurred-with-query state
      // keeps the input visible, and a stale wide measure (taken before
      // a window shrink, or mid rail-expansion) overlapped — and stole
      // clicks from — the right-side header controls. The CSS fallback
      // min(240px, 17vw) covers that state instead.
      chip?.style.removeProperty("--search-w");
    };
  }, [searchOpen]);

  // `/`, Ctrl+K, Ctrl+F focus the pill — VOD side only, never while
  // typing in another field, never while a player is up (its own keys
  // win; #inv-chrome existing = playback chrome mounted).
  useEffect(() => {
    if (section === "live") return;
    const onKey = (e: KeyboardEvent) => {
      const slash =
        e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const combo =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f");
      if (!slash && !combo) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (document.getElementById("inv-chrome")) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section]);

  // The header floats over the tabs; publish its measured height so tabs
  // that shouldn't start underneath can offset themselves (--header-h).
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--header-h",
        `${el.offsetHeight}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header className="header" ref={ref}>
      {/* Progressive blur: stacked backdrop layers with geometrically
       * doubling radii and overlapping mask bands, so the melt decays
       * smoothly with depth (a single blurred layer just fades in opacity,
       * which reads as an abrupt band). */}
      <div className="header__veil" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="header__brand">
        {/* Logo + wordmark grouped so their gap tunes independently of the
          * clock's spacing off the lockup. */}
        <div className="header__lockup">
          <img className="header__logo" src="/logo.png" alt="" />
          <div className="header__title">
            <span className="header__name">BlammyTV</span>
            <span className="header__version">v{APP_VERSION}</span>
          </div>
        </div>
        <span className="header__clock">{clock}</span>
      </div>

      <nav className="header__tabs" aria-label="Sections">
        {/* TWO search buttons flank the tabs — TV-side and VOD-side — and
          * swap via visibility (not display) so the cluster never moves a
          * pixel. Both open Discover's search today; the TV-side slot is
          * reserved for live-channel search when that exists. */}
        <button
          type="button"
          className={
            "header__search" +
            (section === "live" ? "" : " header__search--off")
          }
          aria-label="Search channels"
          aria-hidden={section !== "live"}
          tabIndex={section === "live" ? 0 : -1}
          /* Deliberately INERT: this is the live-channel search slot,
           * completely unlinked from the VOD pill (jumping a TV user to
           * Discover was wrong). Wire it when TV search exists. */
        >
          <SearchIcon />
        </button>
        <span className="header__tab-slot">
          <button
            type="button"
            className={
              "header__tab" + (section === "live" ? " header__tab--active" : "")
            }
            onClick={() => onSection("live")}
          >
            Live TV
          </button>
          {/* The design keeps a fixed divider between Live TV and the rest. */}
          <span className="header__divider">|</span>
        </span>
        {/* Stream tab + its sub-rail grouped, so their gap tunes
          * independently of the tab cluster's 20px rhythm. */}
        <div className="header__streamgroup">
          <button
            type="button"
            className={
              "header__tab" +
              (section === "stream" ? " header__tab--active" : "") +
              // Already at Stream Home = the button is a no-op; don't
              // tease a hover change that clicking won't honor.
              (section === "stream" && streamTab === "home"
                ? " header__tab--inert"
                : "")
            }
            onClick={() => {
              // From Live, entering the section restores the last page
              // (the remember behavior); within the section, Stream is
              // the "back to Home" shortcut.
              if (section === "stream") onStreamTab("home");
              else onSection("stream");
            }}
          >
            Stream
          </button>
          {/* The Stream sub-rail: the section's actual pages, plus the
            * search slot at its end. COLLAPSED — not unmounted — on Live
            * TV, so the section-switch animation (phase 2) is pure CSS
            * width/opacity on .header__rail--off. */}
          <div
            className={
              "header__rail" + (section === "live" ? " header__rail--off" : "")
            }
            aria-hidden={section === "live"}
          >
          {/* The SAME chip slider used in Settings/Discover/the Live
            * sidebar — sliding raised thumb and all — minus the track
            * background. The search chip is the rail's LAST CHIP, an
            * icon square: focusing slides the thumb behind the ICON via
            * thumbKey, while the input floats off the chip absolutely
            * (bare text box, no layout impact — the nav never moves);
            * blur/Escape sends the thumb home to the page pill.
            * (Collapsed rail = visibility:hidden, which also drops the
            * chips from the tab order.) */}
          <ChipTabs
            tabs={RAIL}
            active={streamTab}
            className="chip-tabs--bare"
            thumbKey={searchOpen ? "search" : undefined}
            onChange={(t) => {
              // The Discover PILL means browse: clear any active search
              // so it never lands (or stays) on stale results.
              if (t === "discover") {
                setQuery("");
                setSearchQuery("");
              }
              onStreamTab(t);
            }}
            trailing={
              /* A span, not a button — buttons can't contain inputs.
               * Clicking anywhere on the chip focuses the input. */
              <span
                ref={searchChipRef}
                className="chip-tabs__tab header__searchchip"
                data-tab="search"
                onClick={() => searchInputRef.current?.focus()}
              >
                <SearchIcon aria-hidden />
                <input
                  ref={searchInputRef}
                  className="header__searchinput"
                  type="search"
                  placeholder="Search movies & series…"
                  value={query}
                  tabIndex={section === "live" ? -1 : 0}
                  aria-label="Search movies and series"
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setSearchOpen(false)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearchQuery(e.target.value);
                    // Typing from any Stream page lands where results
                    // are — but CLEARING (the × button, backspace to
                    // empty) must not yank the user off their page.
                    if (e.target.value !== "" && streamTab !== "discover")
                      onStreamTab("discover");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      // Ours alone: without stopPropagation the App-level
                      // listener also exits OS fullscreen on the same press.
                      e.stopPropagation();
                      setQuery("");
                      setSearchQuery("");
                      e.currentTarget.blur();
                    }
                  }}
                />
              </span>
            }
          />
          </div>
        </div>
      </nav>

      <div className="header__right">
        {/* Outside the 0.3-opacity icon cluster on purpose: an available
          * update should read at full strength. */}
        <UpdateChip />
        <div className="header__actions">
          <button type="button" className="header__action" aria-label="Profile">
            <AccountIcon />
          </button>
          <button
            type="button"
            className="header__action"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
