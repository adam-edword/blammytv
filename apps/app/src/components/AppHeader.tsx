import { Fragment, useEffect, useState } from "react";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { TABS, sectionOf, type TabKey } from "./TopTabs";
import { SearchIcon, AccountIcon, SettingsIcon } from "./icons";
import { FocusButton } from "./FocusButton";
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
  onOpenProfile,
  avatar,
  onSearchLive,
  onSearchStream,
  version = `v${APP_VERSION}`,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
  onOpenSettings?: () => void;
  onOpenProfile?: () => void;
  /** Data URL of the profile avatar; replaces the account icon when set. */
  avatar?: string | null;
  onSearchLive?: () => void;
  onSearchStream?: () => void;
  version?: string;
}) {
  const clock = useClock();
  const section = sectionOf(active);

  // Wrap the tab strip in a focus context so that arriving at the nav from below
  // (e.g. Up out of the hero) always lands on the *active* tab, not whichever
  // tab happens to be geometrically nearest. `preferredChildFocusKey` points at
  // the active tab; `saveLastFocusedChild` is off so the preference always wins
  // over the last-focused tab.
  const { ref: tabsRef, focusKey: tabsFocusKey } = useFocusable<HTMLElement>({
    focusKey: "tabs",
    saveLastFocusedChild: false,
    preferredChildFocusKey: `tab-${active}`,
    // Nothing lives above the tabs — ▲ stays put instead of escaping into the
    // void (which dropped the cursor). ▼ still drops into the content.
    isFocusBoundary: true,
    focusBoundaryDirections: ["up"],
  });

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <img
          className="app-header__logo"
          src="/logo.png"
          alt=""
          aria-hidden="true"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
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
        <FocusContext.Provider value={tabsFocusKey}>
          <nav
            className="top-tabs"
            role="tablist"
            aria-label="Sections"
            ref={tabsRef}
          >
            {TABS.map((tab, i) => {
              // A divider sits where the section changes (Live TV | Stream …).
              const startsSection =
                i > 0 && TABS[i - 1].section !== tab.section;
              return (
                <Fragment key={tab.key}>
                  {startsSection && (
                    <span className="app-header__divider" aria-hidden="true">
                      |
                    </span>
                  )}
                  <FocusButton
                    className={
                      "top-tab" + (active === tab.key ? " top-tab--active" : "")
                    }
                    focusKey={`tab-${tab.key}`}
                    autoFocus={active === tab.key}
                    onPress={() => onChange(tab.key)}
                  >
                    {tab.label}
                  </FocusButton>
                </Fragment>
              );
            })}
          </nav>
        </FocusContext.Provider>
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
        <FocusButton
          className={"icon-btn" + (avatar ? " icon-btn--avatar" : "")}
          ariaLabel="Account"
          focusKey="hdr-account"
          onPress={onOpenProfile}
        >
          {avatar ? (
            <img className="icon-btn__avatar" src={avatar} alt="" />
          ) : (
            <AccountIcon />
          )}
        </FocusButton>
        <FocusButton
          className="icon-btn"
          ariaLabel="Settings"
          focusKey="hdr-settings"
          onPress={onOpenSettings}
        >
          <SettingsIcon />
        </FocusButton>
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
