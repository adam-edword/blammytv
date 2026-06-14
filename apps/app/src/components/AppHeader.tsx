import { Fragment, useEffect, useState } from "react";
import { TABS, sectionOf, type TabKey } from "./TopTabs";
import { SearchIcon, AccountIcon, SettingsIcon } from "./icons";

/** Top app chrome: brand + clock, section tabs, account/settings.
 * The tabs are the only nav; nothing here is a settings screen (config lives
 * in the web UI), the gear is just a placeholder affordance for now.
 *
 * The two sections — Live TV and Streaming (Stream + Discover) — each own the
 * search icon: it sits on the left while a Live TV tab is active and on the
 * right while a streaming tab is active. */
export function AppHeader({
  active,
  onChange,
  onOpenSettings,
  onSearch,
  version = "v0.0.1",
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
  onOpenSettings?: () => void;
  onSearch?: () => void;
  version?: string;
}) {
  const clock = useClock();
  const section = sectionOf(active);

  const searchButton = (
    <button
      className="icon-btn"
      aria-label="Search"
      type="button"
      onClick={onSearch}
    >
      <SearchIcon />
    </button>
  );

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
        {section === "live" && searchButton}
        <nav className="top-tabs" role="tablist" aria-label="Sections">
          {TABS.map((tab, i) => {
            // A divider sits where the section changes (Live TV | Stream …).
            const startsSection = i > 0 && TABS[i - 1].section !== tab.section;
            return (
              <Fragment key={tab.key}>
                {startsSection && (
                  <span className="app-header__divider" aria-hidden="true">
                    |
                  </span>
                )}
                <button
                  role="tab"
                  aria-selected={active === tab.key}
                  className={
                    "top-tab" + (active === tab.key ? " top-tab--active" : "")
                  }
                  onClick={() => onChange(tab.key)}
                >
                  {tab.label}
                </button>
              </Fragment>
            );
          })}
        </nav>
        {section === "stream" && searchButton}
      </div>

      <div className="app-header__actions">
        <button className="icon-btn" aria-label="Account" type="button">
          <AccountIcon />
        </button>
        <button
          className="icon-btn"
          aria-label="Settings"
          type="button"
          onClick={onOpenSettings}
        >
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
