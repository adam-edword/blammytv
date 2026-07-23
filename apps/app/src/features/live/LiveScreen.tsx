import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronIcon,
  EyeOffIcon,
  PanelIcon,
  RainbowStarIcon,
  RecentsIcon,
  StarIcon,
  TvIcon,
} from "../../ui/icons";
import {
  isTauri,
  onPopoutClosed,
  tauriMpvFrost,
  tauriMpvFrostRect,
  tauriMpvGoLive,
  tauriPopoutOpen,
  tauriSetFullscreen,
} from "../../lib/tauri";
import { createPortal } from "react-dom";
import { frostRegion } from "./hole";
import { setOverlayApiOverride } from "./overlayApi";
import { TheaterOverlay } from "./TheaterOverlay";
import { useDirectOverlay } from "./useDirectOverlay";

/** Native player present (the inverted layer is THE architecture; in a
 * plain browser tab there is no player at all). */
const INV = isTauri();
import {
  loadPlaylists,
  onPlaylistsChange,
  savePlaylists,
  toggleHiddenCategory,
} from "../settings/playlists";
import { InvertedPlayer } from "./InvertedPlayer";
import { useConnections } from "./connections";
import { splitTitleEmoji } from "./emoji";
import { loadFavorites, toggleFavorite } from "./favorites";
import { Guide } from "./Guide";
import { Hero } from "./Hero";
import type { Channel, LiveData, Programme } from "./model";
import { loadRecents, recordRecent } from "./recents";
import { loadLive, onLiveRefreshed, peekLive } from "./source";
import { buildMeta, resolveStreamUrl } from "./stream";

type Mode = "playlist" | "favorites" | "recents";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "playlist", label: "Playlist" },
  { key: "favorites", label: "Favorites" },
  { key: "recents", label: "Recents" },
];

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: LiveData }
  | { status: "error"; message: string };

const NO_PROGRAMMES: Programme[] = [];

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

  // Roving-tabindex arrow-key navigation (WAI-ARIA tablist): only the active
  // tab is in the tab order; arrows move selection AND focus, Home/End jump to
  // the ends.
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const i = MODES.findIndex((m) => m.key === mode);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = (i + 1) % MODES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + MODES.length) % MODES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MODES.length - 1;
    else return;
    e.preventDefault();
    const key = MODES[next].key;
    onChange(key);
    railRef.current
      ?.querySelector<HTMLButtonElement>(`[data-mode="${key}"]`)
      ?.focus();
  };

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
            tabIndex={active ? 0 : -1}
            className={
              "mode-rail__chip" + (active ? " mode-rail__chip--active" : "")
            }
            onClick={() => onChange(m.key)}
            onKeyDown={onKey}
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

/** The source/folder rail, extracted + memoized: LiveScreen re-renders on
 * every guide hover-preview and folded-rail tooltip move, and this list
 * (groups x folders, splitTitleEmoji per folder) re-rendered every time.
 * Every prop is identity-stable across preview/tip churn (useConnections
 * documents its stable Map; the callbacks are useCallback'd), so memo
 * skips it entirely in the hottest interaction path. */
const SidebarSources = memo(function SidebarSources({
  groups,
  conns,
  closedGroups,
  folder,
  collapsed,
  onToggleGroup,
  onPickFolder,
  onTip,
  onFolderMenu,
  onHideFolder,
}: {
  groups: LiveData["groups"];
  conns: ReturnType<typeof useConnections>;
  closedGroups: Set<string>;
  folder: string | null;
  collapsed: boolean;
  onToggleGroup: (id: string) => void;
  onPickFolder: (id: string, active: boolean) => void;
  onTip: (t: { label: string; x: number; y: number } | null) => void;
  /** Right-click on a folder: open the hide menu at the cursor. */
  onFolderMenu: (m: {
    x: number;
    y: number;
    groupId: string;
    folderId: string;
    name: string;
  }) => void;
  /** The hover eye: hide this folder right now (toast carries the undo). */
  onHideFolder: (groupId: string, folderId: string, name: string) => void;
}) {
  return (
    <div className="live-sidebar__list">
      {groups.map((g) => {
        const open = !closedGroups.has(g.id);
        const c = conns.get(g.id);
        return (
          <Fragment key={g.id}>
            <button
              type="button"
              className="live-group"
              aria-expanded={open}
              onClick={() => onToggleGroup(g.id)}
            >
              <ChevronIcon
                className={
                  "live-group__caret" +
                  (open ? "" : " live-group__caret--closed")
                }
              />
              {g.name}
              {/* Connection usage (Xtream only) — accent at the cap,
               * when the number is the reason a stream won't open. */}
              {c && !collapsed && (
                <span
                  className={
                    "live-conns" + (c.active >= c.max ? " live-conns--full" : "")
                  }
                  title={`${c.active} of ${c.max} connections in use`}
                >
                  {c.active}/{c.max}
                </span>
              )}
            </button>
            {g.error && !collapsed && (
              <p className="live-group__error">
                Couldn&rsquo;t load this playlist — {g.error}
              </p>
            )}
            {open && g.folders.length > 0 && (
              <div
                className="live-sidebar__folders"
                onScroll={() => onTip(null)}
              >
                {g.folders.map((f) => {
                  const { emoji, label } = splitTitleEmoji(f.name);
                  const active = folder === f.id;
                  return (
                    <span className="live-folder-row" key={f.id}>
                      <button
                        type="button"
                        aria-label={label}
                        aria-current={active ? "true" : undefined}
                        // Expanded, long names fade at the edge — a native
                        // tooltip makes the full name recoverable. Folded,
                        // the custom .live-tip owns that, so skip it.
                        title={collapsed ? undefined : label}
                        className={
                          "live-folder" +
                          (active ? " live-folder--active" : "")
                        }
                        onClick={() => onPickFolder(f.id, active)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onTip(null);
                          // Fixed-position coords live in the zoomed space
                          // (the tooltip's pattern). Keyboard menu key sends
                          // 0,0 — anchor on the row instead.
                          const zoom = Number(
                            document.documentElement.style.zoom || 1,
                          );
                          const r = e.currentTarget.getBoundingClientRect();
                          const cx = e.clientX || r.right - 8;
                          const cy = e.clientY || r.top + r.height / 2;
                          onFolderMenu({
                            x: cx / zoom,
                            y: cy / zoom,
                            groupId: g.id,
                            folderId: f.id,
                            name: label,
                          });
                        }}
                        onMouseEnter={(e) => {
                          if (!collapsed) return;
                          const r = e.currentTarget.getBoundingClientRect();
                          // Fixed positioning lives in the zoomed
                          // coordinate space (see the settings
                          // dropdown), so unscale.
                          const zoom = Number(
                            document.documentElement.style.zoom || 1,
                          );
                          onTip({
                            label,
                            x: r.right / zoom + 12,
                            y: (r.top + r.height / 2) / zoom,
                          });
                        }}
                        onMouseLeave={() => onTip(null)}
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
                      {/* The hover eye (the guide-star pattern): hides this
                        * folder in one click; the toast carries the undo.
                        * No room folded — the context menu covers there. */}
                      {!collapsed && (
                        <button
                          type="button"
                          className="live-folder__hide"
                          aria-label={`Hide ${label}`}
                          title={`Hide ${label}`}
                          onClick={() => onHideFolder(g.id, f.id, label)}
                        >
                          <EyeOffIcon />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
});

export function LiveScreen({ modalOpen = false }: { modalOpen?: boolean }) {
  const [mode, setMode] = useState<Mode>("playlist");
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<string | null>(null);
  /** Source-name tooltip for the folded rail (fixed-position so the
   * scrolling list can't clip it). */
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(
    null,
  );
  /** The folder context menu (right-click → Hide): cursor-anchored, one
   * action. Unhide lives in Settings → Playlists' folder editor. */
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    groupId: string;
    folderId: string;
    name: string;
  } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!folderMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!folderMenuRef.current?.contains(e.target as Node))
        setFolderMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFolderMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [folderMenu]);
  /** Optimistically-hidden folder ids: a hide must vanish INSTANTLY, but
   * hiddenCategories is part of the disk-cache fingerprint, so the real
   * pipeline is a debounced full reload (seconds). This set filters the
   * sidebar AND the guide's channels immediately; entries dissolve when a
   * landed reload no longer carries the folder (the applied signal). */
  const [pendingHidden, setPendingHidden] = useState<Set<string>>(
    () => new Set(),
  );
  /** Bottom-center toast — one at a time, 5s, Undo restores the folder. */
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(
    null,
  );
  const toastTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const hideFolderNow = useCallback(
    (groupId: string, folderId: string, name: string) => {
      // folder.id is `${playlistId}:${categoryId}` (source.ts#folderId);
      // hiddenCategories stores the RAW category id — slice by the known
      // playlist prefix. Same store + signal as the Settings editor, so
      // folders/channels/EPG drop together and Live refreshes silently.
      const catId = folderId.slice(groupId.length + 1);
      savePlaylists(toggleHiddenCategory(loadPlaylists(), groupId, catId));
      setPendingHidden((prev) => new Set(prev).add(folderId));
      // Hiding the folder you're filtered to: back to the full guide.
      setFolder((f) => (f === folderId ? null : f));
      setToast({
        msg: `Hid “${name}”`,
        undo: () => {
          savePlaylists(
            toggleHiddenCategory(loadPlaylists(), groupId, catId),
          );
          setPendingHidden((prev) => {
            const next = new Set(prev);
            next.delete(folderId);
            return next;
          });
          window.clearTimeout(toastTimer.current);
          setToast(null);
        },
      });
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 5000);
    },
    [],
  );
  const hideFolder = useCallback(() => {
    setFolderMenu((m) => {
      if (m) hideFolderNow(m.groupId, m.folderId, m.name);
      return null;
    });
  }, [hideFolderNow]);

  // Stable handlers for the memoized SidebarSources (setTip is stable by
  // construction; these two must be too or the memo is defeated).
  const toggleGroup = useCallback(
    (id: string) =>
      setClosedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const pickFolder = useCallback(
    (id: string, active: boolean) => {
      setFolder(active ? null : id);
      // A folded-rail click tunes the EPG to this source. (Identity only
      // changes on collapse toggles — rare, never the hover-churn path.)
      if (collapsed) setMode("playlist");
    },
    [collapsed],
  );
  // Resume the last-watched channel (recents[0]) so a tab switch or app
  // restart doesn't dump the selection back on the catalog's first row.
  const [channelId, setChannelId] = useState(() => loadRecents()[0] ?? "");
  // Whether the native player is live. Selecting a channel starts it
  // (auto-play); the chrome's ✕ (onClose) stops it. Left off on launch
  // so a restored selection doesn't stream until the user actually tunes in.
  const [playing, setPlaying] = useState(false);
  // Player size: mini (default) → theater (large windowed) → fullscreen.
  // The chrome drives these via its DirectOverlayHandlers callbacks; the box
  // geometry is CSS (classes below), the rAF follows.
  const [theater, setTheater] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  /** Hover preview from the guide: the hero shows whatever the cursor is
   * over (channel or exact programme) without changing the selection. */
  const [preview, setPreview] = useState<{
    channel: Channel;
    programme: Programme | null;
  } | null>(null);

  // The live catalog: real Xtream playlists when any are configured, the
  // bundled mock otherwise. Loaded once up front (the old build's proven
  // strategy), served from the session cache on remounts (tab switches
  // unmount this screen), and re-fetched when the playlists change in
  // Settings.
  const [live, setLive] = useState<LoadState>(() => {
    const cached = peekLive();
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  /** What the loader is doing right now — big playlists spend seconds per
   * stage, and a stalled label pinpoints the wedged one. */
  const [stage, setStage] = useState<string | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const seqRef = useRef(0);
  const refresh = useCallback((silent: boolean, force = false) => {
    const seq = ++seqRef.current;
    if (!silent) setLive({ status: "loading" });
    loadLive(
      new Date(),
      (label) => {
        if (seq === seqRef.current && !silent) setStage(label);
      },
      force,
    )
      .then((data) => {
        if (seq === seqRef.current) setLive({ status: "ready", data });
      })
      .catch((err) => {
        if (seq === seqRef.current)
          setLive({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      });
  }, []);
  useEffect(() => {
    // Mounted warm from the cache: nothing to fetch.
    if (liveRef.current.status !== "ready") refresh(false);
  }, [refresh]);
  // Disk-hydrated launches revalidate in the background; when the fresh data
  // lands, re-read the (now-updated) memory cache without a loading flash.
  useEffect(
    () => onLiveRefreshed(() => refresh(true)),
    [refresh],
  );
  useEffect(() => {
    let timer = 0;
    const off = onPlaylistsChange(() => {
      // Settings saves fire per toggle; refetch once the burst settles.
      // Silent while data is already up — no flash back to "Loading".
      // Forced: the whole point is to rebuild past the cache.
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => refresh(liveRef.current.status === "ready", true),
        800,
      );
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [refresh]);

  // Adopt a valid selection whenever the catalog changes: first channel on
  // first load, and again if a refresh dropped the selected one. A stale
  // folder filter clears rather than showing an empty guide.
  useEffect(() => {
    if (live.status !== "ready") return;
    const { channels, groups } = live.data;
    if (channels.length && !channels.some((c) => c.id === channelId))
      setChannelId(channels[0].id);
    if (
      folder &&
      !groups.some((g) => g.folders.some((f) => f.id === folder))
    )
      setFolder(null);
  }, [live, channelId, folder]);

  // Favorites and recents live here (not in the guide) because the modes
  // filter on them. Selecting a channel records it as recent.
  const [favorites, setFavorites] = useState(loadFavorites);
  const [recents, setRecents] = useState(loadRecents);
  const selectChannel = useCallback((id: string) => {
    setChannelId(id);
    setPlaying(true); // auto-play on select
    setRecents((list) => recordRecent(list, id));
  }, []);
  // Leave fullscreen fully — player state + the OS window together.
  const leaveFullscreen = useCallback(() => {
    setFullscreen(false);
    if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
  }, []);
  // The player-chrome handlers (directApi below, plus the popout-closed
  // listener) are stable objects that fire long after the render that made
  // them — they read the live stream URL / channel id off refs kept current
  // each render instead of re-subscribing on every channel change.
  const playUrlRef = useRef<string | null>(null);
  const heroIdRef = useRef<string | undefined>(undefined);
  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((list) => toggleFavorite(list, id));
  }, []);
  // Closing the PiP window brings the stream back in-app as the mini
  // player — popping out is for browsing the EPG, so resuming into theater
  // would just cover the guide the user came back to. (theater is already
  // false from the pop-out; just re-arm playback.) Tauri's listen()
  // reaches shell internals, so guard the browser dev path.
  useEffect(() => {
    if (!isTauri()) return;
    return onPopoutClosed(() => {
      if (heroIdRef.current) setPlaying(true);
    });
  }, []);

  // What the guide shows, per mode, with each channel's programmes riding
  // along. Memoized: a fresh identity per render would bust the guide's
  // memoization on every hover-preview update (it re-renders constantly
  // while scrolling with the cursor over cells).
  // Entries dissolve once a landed reload no longer carries the folder.
  useEffect(() => {
    if (live.status !== "ready") return;
    setPendingHidden((prev) => {
      if (prev.size === 0) return prev;
      const still = new Set(
        [...prev].filter((id) =>
          live.data.groups.some((g) => g.folders.some((f) => f.id === id)),
        ),
      );
      return still.size === prev.size ? prev : still;
    });
  }, [live]);

  const visible = useMemo(() => {
    if (live.status !== "ready") return [];
    const { programmes } = live.data;
    // Optimistic hide: a just-hidden folder's channels drop NOW; the
    // debounced reload catches up and the pending set dissolves.
    const channels = pendingHidden.size
      ? live.data.channels.filter((c) => !pendingHidden.has(c.folderId))
      : live.data.channels;
    const attach = (c: Channel) => ({
      channel: c,
      programmes: programmes.get(c.id) ?? NO_PROGRAMMES,
    });
    if (mode === "favorites")
      // Render in the FAVORITES list order (the user's hand-sort), not source
      // order — reorderFavorite rearranges that list. A channel that isn't
      // loaded (source disabled) drops out.
      return favorites
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is Channel => !!c)
        .map(attach);
    if (mode === "recents")
      return recents
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is Channel => !!c)
        .map(attach);
    return channels
      .filter((c) => !folder || c.folderId === folder)
      .map(attach);
  }, [live, mode, folder, favorites, recents, pendingHidden]);

  const ready = live.status === "ready" ? live.data : null;
  // The sidebar's groups with pending-hidden folders already gone.
  const visibleGroups = useMemo(() => {
    if (!ready) return null;
    if (pendingHidden.size === 0) return ready.groups;
    return ready.groups.map((g) => ({
      ...g,
      folders: g.folders.filter((f) => !pendingHidden.has(f.id)),
    }));
  }, [ready, pendingHidden]);
  // Memoized: hover previews re-render this screen constantly, and a scan
  // over a six-figure channel list per render is real time.
  const heroChannel = useMemo(
    () =>
      ready
        ? (ready.channels.find((c) => c.id === channelId) ??
          ready.channels[0])
        : undefined,
    [ready, channelId],
  );
  // A hover preview shows that channel's own listings, so the hero can
  // find its airing programme when the cursor is on the card (no cell).
  const shownChannel = preview?.channel ?? heroChannel;
  const shownProgrammes =
    (ready && shownChannel && ready.programmes.get(shownChannel.id)) ||
    NO_PROGRAMMES;

  // The native player streams the COMMITTED channel (heroChannel), never the
  // transient hover preview. Resolution is ASYNC (stream.ts): M3U carries
  // its URL, Xtream rebuilds it synchronously under the hood, and Stalker
  // exchanges the channel's cmd via create_link — so the URL lands in state
  // one tick later and the player mounts then (imperceptible for the sync
  // kinds). A null url (mock catalog, browser build, resolve failure) means
  // no player mounts. Keyed on the channel ID, not the object — a background
  // data refresh must not re-resolve (a fresh Stalker link would rebuild the
  // player mid-watch); the ref carries the current object into the effect.
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  // Sidebar connection pills; keyed on the tuned stream so each tune
  // re-polls once the panel has registered the session.
  const conns = useConnections(playUrl);
  const heroChannelRef = useRef(heroChannel);
  heroChannelRef.current = heroChannel;
  const heroId = heroChannel?.id;
  useEffect(() => {
    const ch = heroChannelRef.current;
    if (!(isTauri() && playing && ch)) {
      setPlayUrl(null);
      return;
    }
    let stale = false;
    resolveStreamUrl(ch).then(
      (url) => {
        if (!stale) setPlayUrl(url);
      },
      () => {
        if (!stale) setPlayUrl(null);
      },
    );
    return () => {
      stale = true;
    };
  }, [playing, heroId]);
  playUrlRef.current = playUrl;
  heroIdRef.current = heroChannel?.id;
  // The overlay meta's clock: a 30s pulse (plus a fresh beat on tune-in) so
  // the memoized meta below still tracks programme rollover. Without the
  // memo, this object rebuilt on EVERY render — each guide hover-preview
  // re-rendered the whole theater chrome through useDirectOverlay's
  // identity-keyed meta effect.
  const [metaNow, setMetaNow] = useState(() => new Date());
  useEffect(() => {
    if (!playUrl) return;
    setMetaNow(new Date());
    const id = window.setInterval(() => setMetaNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [playUrl]);
  const playMeta = useMemo(() => {
    if (!playUrl || !ready || !heroChannel) return null;
    const airing = (ready.programmes.get(heroChannel.id) ?? NO_PROGRAMMES).find(
      (p) => p.start <= metaNow && metaNow < p.end,
    );
    return buildMeta(
      heroChannel,
      airing,
      metaNow,
      undefined,
      favorites.includes(heroChannel.id),
    );
  }, [playUrl, ready, heroChannel, favorites, metaNow]);

  // Inline chrome for the inverted player: a direct OverlayApi (mpv commands
  // + a status poll) injected into TheaterOverlay, which renders into a
  // fixed host div OUTSIDE .app-shell — the clip-path hole would cut any
  // chrome painted inside the shell. InvertedPlayer keeps the host glued
  // to the slot rect alongside the hole itself.
  const directApi = useDirectOverlay(INV && !!playUrl, playUrl, playMeta, {
    onClose: () => {
      setPlaying(false);
      setTheater(false);
      leaveFullscreen();
    },
    onExpand: () => setTheater(true),
    onCollapse: () => {
      setTheater(false);
      leaveFullscreen();
    },
    onFullscreen: () => {
      setFullscreen(true);
      void tauriSetFullscreen(true).catch(() => {});
    },
    onExitFullscreen: leaveFullscreen,
    onPopout: () => {
      const url = playUrlRef.current;
      // Heal the shell's clip hole BEFORE Rust tears the video child down:
      // popout_open closes the in-app player main-thread-side, and losing
      // the race against InvertedPlayer's unmount cleanup would flash the
      // desktop through the still-cut hole. Idempotent with that cleanup.
      const shell = document.querySelector<HTMLElement>(".app-shell");
      if (shell) shell.style.clipPath = "";
      if (url) void tauriPopoutOpen(url).catch(() => {});
      setPlaying(false);
      setTheater(false);
      leaveFullscreen();
    },
    onToggleFavorite: () => {
      const id = heroIdRef.current;
      if (id) handleToggleFavorite(id);
    },
    // Go-live for Stalker channels re-resolves the URL first: the playing
    // one's play_token is short-lived, and mpv's in-place reload of a stale
    // token is a guaranteed 403. A changed URL swaps into state and rebuilds
    // the player fresh; same-URL (token still valid) and every other kind
    // fall through to the plain reload. The tune watchdog's silent retries
    // ride this same handler, so mid-play death recovery gets fresh tokens.
    onGoLive: () => {
      const ch = heroChannelRef.current;
      if (!ch?.streamCmd) {
        void tauriMpvGoLive().catch(() => {});
        return;
      }
      resolveStreamUrl(ch).then(
        (url) => {
          if (heroIdRef.current !== ch.id) return; // switched away meanwhile
          if (url && url !== playUrlRef.current) setPlayUrl(url);
          else void tauriMpvGoLive().catch(() => {});
        },
        () => void tauriMpvGoLive().catch(() => {}),
      );
    },
  });
  // First-frame gate for the shell hole (see InvertedPlayer.ready): the
  // status poll's loading signal — true re-arms on every tune, false on
  // mpv's first presented frame.
  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => directApi.onLoading((v) => setVideoReady(!v)), [directApi]);
  // Must be set before TheaterOverlay renders (its state initializers read
  // the api synchronously); idempotent, so the render-path call is safe.
  if (INV) setOverlayApiOverride(directApi);
  const chromeHostRef = useRef<HTMLDivElement | null>(null);
  if (INV && !chromeHostRef.current) {
    const host = document.createElement("div");
    host.id = "inv-chrome";
    chromeHostRef.current = host;
  }
  useEffect(() => {
    const host = chromeHostRef.current;
    if (!host) return;
    document.body.appendChild(host);
    return () => {
      host.remove();
      setOverlayApiOverride(null);
    };
  }, []);

  // Live glass: while a modal covers the app, mpv GPU-blurs ONLY the
  // region under the settings card. The shader loads once; every geometry
  // change (tab-switch reflows via ResizeObserver, window resizes) is a
  // pure uniform update, rAF-throttled — no reloads, no stale rects. The
  // rect hugs the card exactly (no pad), so the frost never halos.
  useEffect(() => {
    if (!modalOpen || !INV || !playUrlRef.current) return;
    // data-frost signals capability to CSS: "0" downgrades the settings
    // card to a solid background (glass over un-frostable live video is
    // unreadable). Absent = normal glass (no video, or frost active).
    void tauriMpvFrost(true)
      .then((ok) => {
        document.documentElement.dataset.frost = ok ? "1" : "0";
      })
      .catch(() => {
        document.documentElement.dataset.frost = "0";
      });
    let raf = 0;
    const push = () => {
      raf = 0;
      const slot = document.getElementById("player-slot");
      const card = document.querySelector(".settings");
      if (!slot || !card) return;
      const r = frostRegion(
        slot.getBoundingClientRect(),
        card.getBoundingClientRect(),
      );
      // Degenerate (card off the video) → parked uniforms = no frost.
      if (!r) void tauriMpvFrostRect(1, 1, 0, 0).catch(() => {});
      else void tauriMpvFrostRect(r.x0, r.y0, r.x1, r.y1).catch(() => {});
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(push);
    };
    queue();
    const ro = new ResizeObserver(queue);
    const card = document.querySelector(".settings");
    const slot = document.getElementById("player-slot");
    if (card) ro.observe(card);
    if (slot) ro.observe(slot);
    window.addEventListener("resize", queue);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", queue);
      if (raf) cancelAnimationFrame(raf);
      delete document.documentElement.dataset.frost;
      void tauriMpvFrost(false).catch(() => {});
    };
  }, [modalOpen]);

  return (
    <div
      className={
        "live" +
        (theater ? " live--theater" : "") +
        (fullscreen ? " live--fullscreen" : "")
      }
    >
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
        {(collapsed || mode === "playlist") && ready && (
          <SidebarSources
            groups={visibleGroups ?? ready.groups}
            conns={conns}
            closedGroups={closedGroups}
            folder={folder}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            onPickFolder={pickFolder}
            onTip={setTip}
            onFolderMenu={setFolderMenu}
            onHideFolder={hideFolderNow}
          />
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

      {folderMenu && (
        <div
          ref={folderMenuRef}
          className="folder-menu"
          role="menu"
          aria-label={`${folderMenu.name} options`}
          style={{ left: folderMenu.x, top: folderMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="folder-menu__item"
            autoFocus
            onClick={hideFolder}
          >
            Hide &ldquo;{folderMenu.name}&rdquo;
          </button>
          <p className="folder-menu__hint">
            Unhide any time in Settings &rarr; Playlists.
          </p>
        </div>
      )}

      {toast && (
        <div className="live-toast" role="status">
          <span className="live-toast__msg">{toast.msg}</span>
          <button
            type="button"
            className="live-toast__undo"
            onClick={toast.undo}
          >
            Undo
          </button>
        </div>
      )}

      <div className="live-main">
        {live.status === "loading" && (
          <div className="live-status" role="status" aria-live="polite">
            <p>{stage ?? "Loading channels…"}</p>
          </div>
        )}
        {live.status === "error" && (
          <div
            className="live-status live-status--error"
            role="alert"
          >
            <p>
              Couldn&rsquo;t load your playlists — {live.message}. Check them in
              Settings → Playlists.
            </p>
            <button
              type="button"
              className="live-status__retry"
              onClick={() => refresh(false)}
            >
              Try again
            </button>
          </div>
        )}
        {ready &&
          !shownChannel &&
          (ready.groups.find((g) => g.error) ? (
            <div className="live-status live-status--error" role="alert">
              <p>
                Couldn&rsquo;t load your playlists —{" "}
                {ready.groups.find((g) => g.error)!.error}. Check them in
                Settings → Playlists.
              </p>
              <button
                type="button"
                className="live-status__retry"
                onClick={() => refresh(false)}
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="live-status" role="status">
              <p>No channels here yet. Add a playlist in Settings → Playlists.</p>
            </div>
          ))}
        {ready && shownChannel && (
          <>
            <Hero
              channel={shownChannel}
              programmes={shownProgrammes}
              programme={preview?.programme ?? undefined}
              // Theater only: clicking the black space around the picture
              // drops back to mini (clicks ON the picture hit the inline
              // chrome, which owns play/pause). Fullscreen has no space to
              // click, mini's hero space is normal UI.
              onBackdropClick={
                theater && !fullscreen ? () => setTheater(false) : undefined
              }
            />
            {/* Headless: opens mpv into #player-slot and follows the box.
             * Only in Tauri with a real stream URL, so browser/mock is
             * untouched. */}
            {playUrl && (
              <InvertedPlayer
                url={playUrl}
                squared={theater || fullscreen}
                ready={videoReady}
              />
            )}
            {/* Inverted path: the player chrome lives in the main webview,
             * portaled outside the shell so the clip hole can't cut it. */}
            {INV &&
              playUrl &&
              chromeHostRef.current &&
              createPortal(
                <TheaterOverlay
                  frame={
                    fullscreen ? "fullscreen" : theater ? "theater" : "mini"
                  }
                  playbackKey={playUrl}
                />,
                chromeHostRef.current,
              )}
            {visible.length === 0 ? (
              <div className="guide-empty">
                <p>
                  {mode === "favorites"
                    ? "Nothing starred yet — hover a channel card and hit the star."
                    : mode === "recents"
                      ? "Nothing watched yet — recents fill in as you tune around."
                      : "No channels in this folder."}
                </p>
              </div>
            ) : (
              <Guide
                channels={visible}
                selectedId={channelId}
                favorites={favorites}
                resetKey={`${mode}|${folder ?? ""}`}
                onSelect={selectChannel}
                onToggleFavorite={handleToggleFavorite}
                onPreview={setPreview}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
