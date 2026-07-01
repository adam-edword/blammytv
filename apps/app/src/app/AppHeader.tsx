import { useEffect, useState } from "react";
import { AccountIcon, SearchIcon, SettingsIcon } from "../ui/icons";
import { formatClock } from "../lib/time";
import { APP_VERSION } from "../lib/version";

export type TabKey = "live" | "stream" | "discover";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "live", label: "Live TV" },
  { key: "stream", label: "Stream" },
  { key: "discover", label: "Discover" },
];

/** Live clock, minute-accurate (the header shows no seconds). */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return formatClock(now);
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

  return (
    <header className="header">
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
