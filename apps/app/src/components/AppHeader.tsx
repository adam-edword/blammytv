import { useEffect, useState } from "react";
import { TABS, type TabKey } from "./TopTabs";
import { SearchIcon, AccountIcon, SettingsIcon } from "./icons";

/** Top app chrome: brand + clock, section tabs, account/settings.
 * The tabs are the only nav; nothing here is a settings screen (config lives
 * in the web UI), the gear is just a placeholder affordance for now. */
export function AppHeader({
  active,
  onChange,
  version = "v0.0.1",
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
  version?: string;
}) {
  const clock = useClock();

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <div className="app-header__title">
          <span className="app-header__name">BlammyTV</span>
          <span className="app-header__version">{version}</span>
        </div>
        <span className="app-header__clock">{clock}</span>
      </div>

      <div className="app-header__center">
        <button className="icon-btn" aria-label="Search" type="button">
          <SearchIcon />
        </button>
        <span className="app-header__divider" aria-hidden="true">
          |
        </span>
        <nav className="top-tabs" role="tablist" aria-label="Sections">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active === tab.key}
              className={"top-tab" + (active === tab.key ? " top-tab--active" : "")}
              onClick={() => onChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="app-header__actions">
        <button className="icon-btn" aria-label="Account" type="button">
          <AccountIcon />
        </button>
        <button className="icon-btn" aria-label="Settings" type="button">
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}

function useClock(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return new Date(now).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
