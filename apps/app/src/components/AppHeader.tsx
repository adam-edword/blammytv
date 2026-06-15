import { Fragment, useEffect, useState } from "react";
import { TABS, sectionOf, type TabKey } from "./TopTabs";
import { SearchIcon, AccountIcon, SettingsIcon } from "./icons";
import { APP_VERSION } from "../version";

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
  onSearchLive,
  onSearchStream,
  version = `v${APP_VERSION}`,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
  onOpenSettings?: () => void;
  onSearchLive?: () => void;
  onSearchStream?: () => void;
  version?: string;
}) {
  const clock = useClock();
  const section = sectionOf(active);

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
        {/* Each section has its own search (a different engine), on that
            section's outer edge. Both slots are always rendered — the inactive
            one is hidden but keeps its space — so the tabs never shift. */}
        <button
          className={"icon-btn" + (section === "live" ? "" : " icon-btn--ghost")}
          aria-label="Search live channels"
          aria-hidden={section !== "live"}
          tabIndex={section === "live" ? undefined : -1}
          type="button"
          onClick={onSearchLive}
        >
          <SearchIcon />
        </button>
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
        <button
          className={
            "icon-btn" + (section === "stream" ? "" : " icon-btn--ghost")
          }
          aria-label="Search streaming"
          aria-hidden={section !== "stream"}
          tabIndex={section === "stream" ? undefined : -1}
          type="button"
          onClick={onSearchStream}
        >
          <SearchIcon />
        </button>
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
