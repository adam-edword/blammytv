import { useLayoutEffect, useRef, useState } from "react";
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

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "playlist", label: "Playlist" },
  { key: "favorites", label: "Favorites" },
  { key: "recents", label: "Recents" },
];

function ModeIcon({ mode, active }: { mode: Mode; active: boolean }) {
  if (mode === "playlist") return <TvIcon />;
  if (mode === "favorites") return active ? <RainbowStarIcon /> : <StarIcon />;
  return <RecentsIcon />;
}

/** The mode rail, built to the Claude app's actual mechanics (verified from
 * its DOM): buttons resize INSTANTLY when the label collapses/expands, and a
 * single indicator element glides to the settled target via transform+width.
 * One animated element, exact one-shot measurement, nothing to chase. */
function ModeRail({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0, snap: true });

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = (snap: boolean) => {
      const btn = rail.querySelector<HTMLButtonElement>(
        `[data-mode="${mode}"]`,
      );
      if (btn) {
        setInd((prev) => ({
          x: btn.offsetLeft,
          w: btn.offsetWidth,
          // First placement snaps into position; later ones glide.
          snap: snap || prev.w === 0,
        }));
      }
    };
    measure(false);
    // Font load / rail resize move the settled targets — reposition
    // without animating.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure(true);
    });
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(rail);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [mode]);

  return (
    <div className="mode-rail" role="tablist" ref={railRef}>
      <div
        className={
          "mode-rail__indicator" +
          (ind.snap ? " mode-rail__indicator--snap" : "")
        }
        style={{
          transform: `translateX(${ind.x}px)`,
          width: ind.w,
          visibility: ind.w ? "visible" : "hidden",
        }}
        aria-hidden
      />
      {MODES.map((m) => {
        const active = m.key === mode;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            data-mode={m.key}
            aria-selected={active}
            aria-label={m.label}
            className={
              "mode-rail__chip" + (active ? " mode-rail__chip--active" : "")
            }
            onClick={() => onChange(m.key)}
          >
            <ModeIcon mode={m.key} active={active} />
            <span className="mode-rail__label">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
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
          {!collapsed && <ModeRail mode={mode} onChange={setMode} />}
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
