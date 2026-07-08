import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccountIcon, SearchIcon, SettingsIcon } from "../ui/icons";
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
        <img className="header__logo" src="/logo.png" alt="" />
        <div className="header__title">
          <span className="header__name">BlammyTV</span>
          <span className="header__version">v{APP_VERSION}</span>
        </div>
        <span className="header__clock">{clock}</span>
      </div>

      <nav className="header__tabs" aria-label="Sections">
        {/* Search is drawn in the redesign but not wired yet. */}
        <SearchIcon className="header__search" aria-hidden />
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
      </nav>

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
    </header>
  );
}
