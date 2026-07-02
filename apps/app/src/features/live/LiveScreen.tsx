import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronIcon,
  PanelIcon,
  RainbowStarIcon,
  RecentsIcon,
  StarIcon,
  TvIcon,
} from "../../ui/icons";
import { splitTitleEmoji } from "./emoji";
import { loadFavorites, toggleFavorite } from "./favorites";
import { Guide } from "./Guide";
import { Hero } from "./Hero";
import { loadRecents, recordRecent } from "./recents";
import {
  MOCK_CHANNELS,
  MOCK_FOLDERS,
  MOCK_PLAYLIST_NAME,
  type MockChannel,
  type Programme,
} from "./mock";

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
            {/* All three labels stack in one grid cell so the active pill
             * is the same width in every mode — otherwise space-between
             * nudges the idle icons as the pill's label length changes. */}
            <span className="mode-rail__label" aria-hidden>
              {MODES.map((x) => (
                <span
                  key={x.key}
                  className={
                    "mode-rail__label-line" +
                    (x.key === m.key ? "" : " mode-rail__label-line--ghost")
                  }
                >
                  {x.label}
                </span>
              ))}
            </span>
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
  /** Source-name tooltip for the folded rail (fixed-position so the
   * scrolling list can't clip it). */
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(
    null,
  );
  const [channelId, setChannelId] = useState(MOCK_CHANNELS[0].id);
  /** Hover preview from the guide: the hero shows whatever the cursor is
   * over (channel or exact programme) without changing the selection. */
  const [preview, setPreview] = useState<{
    channel: MockChannel;
    programme: Programme | null;
  } | null>(null);

  // Favorites and recents live here (not in the guide) because the modes
  // filter on them. Selecting a channel records it as recent.
  const [favorites, setFavorites] = useState(loadFavorites);
  const [recents, setRecents] = useState(loadRecents);
  const selectChannel = useCallback((id: string) => {
    setChannelId(id);
    setRecents((list) => recordRecent(list, id));
  }, []);
  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((list) => toggleFavorite(list, id));
  }, []);

  // What the guide shows, per mode. Original indices ride along so each
  // channel's deterministic mock programmes stay stable. Memoized: a fresh
  // identity per render would bust the guide's memoization on every
  // hover-preview update (it re-renders constantly while scrolling with
  // the cursor over cells).
  const indexed = (channel: MockChannel) => ({
    channel,
    index: MOCK_CHANNELS.indexOf(channel),
  });
  const visible = useMemo(() => {
    if (mode === "favorites")
      return MOCK_CHANNELS.filter((c) => favorites.includes(c.id)).map(
        indexed,
      );
    if (mode === "recents")
      return recents
        .map((id) => MOCK_CHANNELS.find((c) => c.id === id))
        .filter((c): c is MockChannel => !!c)
        .map(indexed);
    return MOCK_CHANNELS.filter((c) => !folder || c.folder === folder).map(
      indexed,
    );
  }, [mode, folder, favorites, recents]);

  const heroChannel =
    MOCK_CHANNELS.find((c) => c.id === channelId) ?? MOCK_CHANNELS[0];

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
            onClick={() => {
              setTip(null);
              setCollapsed((c) => !c);
            }}
          >
            <PanelIcon />
          </button>
          {!collapsed && <ModeRail mode={mode} onChange={setMode} />}
        </div>

        {/* The source list stays mounted through collapse — the same rows
         * just lose their labels, so the icons never move and scroll
         * position survives. Folded, it doubles as a quick-switch rail. */}
        {(collapsed || mode === "playlist") && (
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
              <div
                className="live-sidebar__folders"
                onScroll={() => setTip(null)}
              >
                {MOCK_FOLDERS.map((f) => {
                  const { emoji, label } = splitTitleEmoji(f);
                  const active = folder === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-label={label}
                      className={
                        "live-folder" + (active ? " live-folder--active" : "")
                      }
                      onClick={() => {
                        setFolder(active ? null : f);
                        // A folded-rail click tunes the EPG to this source.
                        if (collapsed) setMode("playlist");
                      }}
                      onMouseEnter={(e) => {
                        if (!collapsed) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        // Fixed positioning lives in the zoomed coordinate
                        // space (see the settings dropdown), so unscale.
                        const zoom = Number(
                          document.documentElement.style.zoom || 1,
                        );
                        setTip({
                          label,
                          x: r.right / zoom + 12,
                          y: (r.top + r.height / 2) / zoom,
                        });
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      {emoji ? (
                        <span className="live-folder__emoji" aria-hidden>
                          {emoji}
                        </span>
                      ) : (
                        <TvIcon className="live-folder__icon" />
                      )}
                      <span className="live-folder__name">{label}</span>
                    </button>
                  );
                })}
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

      {collapsed && tip && (
        <div className="live-tip" style={{ left: tip.x, top: tip.y }} aria-hidden>
          {tip.label}
        </div>
      )}

      <div className="live-main">
        <Hero
          channel={preview?.channel ?? heroChannel}
          programme={preview?.programme ?? undefined}
        />
        {visible.length === 0 && mode !== "playlist" ? (
          <div className="guide-empty">
            <p>
              {mode === "favorites"
                ? "Nothing starred yet — hover a channel card and hit the star."
                : "Nothing watched yet — recents fill in as you tune around."}
            </p>
          </div>
        ) : (
          <Guide
            channels={visible}
            selectedId={channelId}
            favorites={favorites}
            onSelect={selectChannel}
            onToggleFavorite={handleToggleFavorite}
            onPreview={setPreview}
          />
        )}
      </div>
    </div>
  );
}
