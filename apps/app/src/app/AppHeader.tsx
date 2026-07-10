import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccountIcon, SearchIcon, SettingsIcon } from "../ui/icons";
import { setSearchQuery } from "../features/discover/searchQuery";
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
 * here + in RAIL + a screen in App's switch — nothing else. "mylist"
 * lands with its spec. */
export type StreamTab = "home" | "discover";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
];

const RAIL: Array<{ key: StreamTab; label: string }> = [
  { key: "home", label: "Home" },
  { key: "discover", label: "Discover" },
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
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        {SECTIONS.map((s, i) => (
          <span key={s.key} className="header__tab-slot">
            <button
              type="button"
              className={
                "header__tab" +
                (s.key === section ? " header__tab--active" : "")
              }
              onClick={() => onSection(s.key)}
            >
              {s.label}
            </button>
            {/* The design keeps a fixed divider between Live TV and the rest. */}
            {i === 0 && <span className="header__divider">|</span>}
          </span>
        ))}
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
          {RAIL.map((t) => (
            <button
              key={t.key}
              type="button"
              className={
                "header__pill" +
                (t.key === streamTab ? " header__pill--active" : "")
              }
              tabIndex={section === "live" ? -1 : 0}
              onClick={() => {
                // The Discover PILL means browse: clear any active search
                // so it never lands (or stays) on stale results.
                if (t.key === "discover") {
                  setQuery("");
                  setSearchQuery("");
                }
                onStreamTab(t.key);
              }}
            >
              {t.label}
            </button>
          ))}
          {/* The search PILL. The in-flow slot stays icon-sized; the
            * actual pill renders absolutely off that anchor and extends
            * rightward over empty header space. */}
          <span className="header__searchslot">
            {/* The whole pill focuses the input — the icon is the visible
              * target when everything else is hidden at rest. */}
            <span
              className="header__searchpill"
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
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchQuery(e.target.value);
                  // Typing from any Stream page lands where results are.
                  if (streamTab !== "discover") onStreamTab("discover");
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
          </span>
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
