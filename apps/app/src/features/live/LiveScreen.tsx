import { useState, type ReactNode } from "react";
import { ChipTabs } from "../../ui/ChipTabs";
import {
  ChevronIcon,
  PanelIcon,
  RainbowStarIcon,
  RecentsIcon,
  SquareIcon,
  StarIcon,
  TvIcon,
} from "../../ui/icons";
import { MOCK_FOLDERS, MOCK_PLAYLIST_NAME } from "./mock";

type Mode = "playlist" | "favorites" | "recents";

/** Mode chips show icon-only when inactive; the active one reveals its name
 * (the sliding thumb resizes to fit). Favorites gets the rainbow star. */
function modeTabs(
  active: Mode,
): Array<{ key: Mode; label: ReactNode; ariaLabel: string }> {
  return [
    {
      key: "playlist",
      ariaLabel: "Playlist",
      label:
        active === "playlist" ? (
          <>
            <TvIcon /> Playlist
          </>
        ) : (
          <TvIcon />
        ),
    },
    {
      key: "favorites",
      ariaLabel: "Favorites",
      label:
        active === "favorites" ? (
          <>
            <RainbowStarIcon /> Favorites
          </>
        ) : (
          <StarIcon />
        ),
    },
    {
      key: "recents",
      ariaLabel: "Recents",
      label:
        active === "recents" ? (
          <>
            <RecentsIcon /> Recents
          </>
        ) : (
          <RecentsIcon />
        ),
    },
  ];
}

export function LiveScreen() {
  const [mode, setMode] = useState<Mode>("playlist");
  const [collapsed, setCollapsed] = useState(false);
  const [groupOpen, setGroupOpen] = useState(true);
  const [folder, setFolder] = useState<string | null>(null);

  return (
    <div className="live">
      <aside
        className={"live-sidebar" + (collapsed ? " live-sidebar--collapsed" : "")}
      >
        <div className="live-sidebar__top">
          <button
            type="button"
            className="live-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            <PanelIcon />
          </button>
          {!collapsed && (
            <ChipTabs tabs={modeTabs(mode)} active={mode} onChange={setMode} />
          )}
        </div>

        {!collapsed && mode === "playlist" && (
          <div className="live-sidebar__list">
            <button
              type="button"
              className="live-group"
              aria-expanded={groupOpen}
              onClick={() => setGroupOpen((o) => !o)}
            >
              <ChevronIcon
                className={
                  "live-group__caret" +
                  (groupOpen ? "" : " live-group__caret--closed")
                }
              />
              {MOCK_PLAYLIST_NAME}
            </button>
            {groupOpen && (
              <div className="live-sidebar__folders">
                {MOCK_FOLDERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={
                      "live-folder" +
                      (folder === f ? " live-folder--active" : "")
                    }
                    onClick={() => setFolder(folder === f ? null : f)}
                  >
                    <SquareIcon className="live-folder__icon" />
                    <span className="live-folder__name">{f}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!collapsed && mode !== "playlist" && (
          <p className="live-sidebar__note">
            {mode === "favorites"
              ? "Starred channels fill the guide here."
              : "Recently watched channels land here."}
          </p>
        )}
      </aside>

      <div className="live-main">
        <p className="live-main__placeholder">
          Hero and guide rebuild next, section by section.
        </p>
      </div>
    </div>
  );
}
