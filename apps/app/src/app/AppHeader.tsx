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

export type TabKey = "live" | "stream" | "discover";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
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
  active,
  onChange,
  onOpenSettings,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  onOpenSettings: () => void;
}) {
  const clock = useClock();
  // Controlled mirror of the shared search store (the store is the truth
  // DiscoverScreen renders from; local state keeps the input snappy).
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

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
            "header__search" + (active === "live" ? "" : " header__search--off")
          }
          aria-label="Search"
          aria-hidden={active !== "live"}
          tabIndex={active === "live" ? 0 : -1}
          onClick={() => {
            onChange("discover");
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }}
        >
          <SearchIcon />
        </button>
        {TABS.map((tab, i) => (
          <span key={tab.key} className="header__tab-slot">
            <button
              type="button"
              className={
                "header__tab" + (tab.key === active ? " header__tab--active" : "")
              }
              onClick={() => onChange(tab.key)}
            >
              {tab.label}
            </button>
            {/* The design keeps a fixed divider between Live TV and the rest. */}
            {i === 0 && <span className="header__divider">|</span>}
          </span>
        ))}
        {/* VOD side: the search PILL. The in-flow slot stays icon-sized
          * (mirrors the TV icon, keeping the tab cluster symmetric and
          * immobile); the actual pill renders absolutely off that anchor
          * and extends rightward over empty header space. */}
        <span
          className={
            "header__searchslot" +
            (active === "live" ? " header__search--off" : "")
          }
          aria-hidden={active === "live"}
        >
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
              tabIndex={active === "live" ? -1 : 0}
              aria-label="Search movies and series"
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchQuery(e.target.value);
                // Typing from the Stream tab lands you where results are.
                if (active !== "discover") onChange("discover");
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearchQuery("");
                }
              }}
            />
          </span>
        </span>
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
