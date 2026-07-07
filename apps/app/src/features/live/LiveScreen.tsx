import {
  Fragment,
  useCallback,
  useEffect,
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
import {
  isTauri,
  onCompClosed,
  onCompCollapse,
  onCompExitFullscreen,
  onCompExpand,
  onCompFullscreen,
  tauriCompKey,
  tauriSetFullscreen,
} from "../../lib/tauri";
import { onPlaylistsChange } from "../settings/playlists";
import { CompositionPlayer } from "./CompositionPlayer";
import { splitTitleEmoji } from "./emoji";
import { loadFavorites, toggleFavorite } from "./favorites";
import { Guide } from "./Guide";
import { Hero } from "./Hero";
import type { Channel, LiveData, Programme } from "./model";
import { loadRecents, recordRecent } from "./recents";
import { loadLive, peekLive } from "./source";
import { buildMeta, channelStreamUrl } from "./stream";

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
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<string | null>(null);
  /** Source-name tooltip for the folded rail (fixed-position so the
   * scrolling list can't clip it). */
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(
    null,
  );
  // Resume the last-watched channel (recents[0]) so a tab switch or app
  // restart doesn't dump the selection back on the catalog's first row.
  const [channelId, setChannelId] = useState(() => loadRecents()[0] ?? "");
  // Whether the native player is live. Selecting a channel starts it
  // (auto-play); the overlay's ✕ (comp-closed) stops it. Left off on launch
  // so a restored selection doesn't stream until the user actually tunes in.
  const [playing, setPlaying] = useState(false);
  // Player size: mini (default) → theater (large windowed) → fullscreen. The
  // overlay drives these via comp-* events; the box geometry is CSS (classes
  // below), the rAF follows.
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
  // Native player events. The overlay drives the size transitions; we mirror
  // them into React state (which drives the box geometry classes) and take the
  // OS window fullscreen to match. ✕ stops playback and resets everything.
  // Tauri's listen() reaches shell internals, so guard the browser dev path.
  useEffect(() => {
    if (!isTauri()) return;
    const offs = [
      onCompExpand(() => setTheater(true)),
      onCompCollapse(() => {
        setTheater(false);
        leaveFullscreen();
      }),
      onCompFullscreen(() => {
        setFullscreen(true);
        void tauriSetFullscreen(true).catch(() => {});
      }),
      onCompExitFullscreen(leaveFullscreen),
      onCompClosed(() => {
        setPlaying(false);
        setTheater(false);
        leaveFullscreen();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [leaveFullscreen]);

  // Theater dims the floating nav to a peek (full opacity on hover) instead of
  // hiding it behind the backdrop. Fullscreen stays fully immersive (the
  // fill-the-screen video covers it), so only flag plain theater.
  useEffect(() => {
    document.body.classList.toggle("player-theater", theater && !fullscreen);
    return () => document.body.classList.remove("player-theater");
  }, [theater, fullscreen]);

  // While playing, forward the player shortcuts to the overlay (which owns mpv
  // + the size transitions). The guide has focus, so these keys hit the main
  // webview; comp_key relays them. Skips text fields.
  useEffect(() => {
    if (!isTauri() || !playing) return;
    const SHORTCUTS = new Set([
      " ",
      "k",
      "m",
      "f",
      "t",
      "j",
      "l",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Escape",
    ]);
    const onKey = (e: KeyboardEvent) => {
      if (!SHORTCUTS.has(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      void tauriCompKey(e.key).catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((list) => toggleFavorite(list, id));
  }, []);

  // What the guide shows, per mode, with each channel's programmes riding
  // along. Memoized: a fresh identity per render would bust the guide's
  // memoization on every hover-preview update (it re-renders constantly
  // while scrolling with the cursor over cells).
  const visible = useMemo(() => {
    if (live.status !== "ready") return [];
    const { channels, programmes } = live.data;
    const attach = (c: Channel) => ({
      channel: c,
      programmes: programmes.get(c.id) ?? NO_PROGRAMMES,
    });
    if (mode === "favorites")
      return channels.filter((c) => favorites.includes(c.id)).map(attach);
    if (mode === "recents")
      return recents
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is Channel => !!c)
        .map(attach);
    return channels
      .filter((c) => !folder || c.folderId === folder)
      .map(attach);
  }, [live, mode, folder, favorites, recents]);

  const ready = live.status === "ready" ? live.data : null;
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
  // transient hover preview. The URL is rebuilt from the channel id; a null
  // url (mock catalog, or a browser build) means no player mounts.
  const playUrl =
    isTauri() && playing && heroChannel
      ? channelStreamUrl(heroChannel.id)
      : null;
  const playMeta = (() => {
    if (!playUrl || !ready || !heroChannel) return null;
    const at = new Date();
    const airing = (ready.programmes.get(heroChannel.id) ?? NO_PROGRAMMES).find(
      (p) => p.start <= at && at < p.end,
    );
    return buildMeta(heroChannel, airing, at);
  })();

  return (
    <div
      className={
        "live" +
        (theater ? " live--theater" : "") +
        (fullscreen ? " live--fullscreen" : "")
      }
      onClick={
        theater && !fullscreen
          ? (e) => {
              // Theater backdrop click (outside the player box) → mini. The
              // mpv layer swallows clicks on the box itself, so anything React
              // sees here is genuinely outside it.
              if (!(e.target as Element).closest(".hero__preview"))
                setTheater(false);
            }
          : undefined
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
          <div className="live-sidebar__list">
            {ready.groups.map((g) => {
              const open = !closedGroups.has(g.id);
              return (
                <Fragment key={g.id}>
                  <button
                    type="button"
                    className="live-group"
                    aria-expanded={open}
                    onClick={() =>
                      setClosedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      })
                    }
                  >
                    <ChevronIcon
                      className={
                        "live-group__caret" +
                        (open ? "" : " live-group__caret--closed")
                      }
                    />
                    {g.name}
                  </button>
                  {g.error && !collapsed && (
                    <p className="live-group__error">
                      Couldn't load this playlist — {g.error}
                    </p>
                  )}
                  {open && g.folders.length > 0 && (
                    <div
                      className="live-sidebar__folders"
                      onScroll={() => setTip(null)}
                    >
                      {g.folders.map((f) => {
                        const { emoji, label } = splitTitleEmoji(f.name);
                        const active = folder === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            aria-label={label}
                            // Expanded, long names fade at the edge — a native
                            // tooltip makes the full name recoverable. Folded,
                            // the custom .live-tip owns that, so skip it.
                            title={collapsed ? undefined : label}
                            className={
                              "live-folder" +
                              (active ? " live-folder--active" : "")
                            }
                            onClick={() => {
                              setFolder(active ? null : f.id);
                              // A folded-rail click tunes the EPG to this
                              // source.
                              if (collapsed) setMode("playlist");
                            }}
                            onMouseEnter={(e) => {
                              if (!collapsed) return;
                              const r =
                                e.currentTarget.getBoundingClientRect();
                              // Fixed positioning lives in the zoomed
                              // coordinate space (see the settings
                              // dropdown), so unscale.
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
                              <span
                                className="live-folder__emoji"
                                aria-hidden
                              >
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
                </Fragment>
              );
            })}
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
        {live.status === "loading" && (
          <div className="live-status">
            <p>{stage ?? "Loading channels…"}</p>
          </div>
        )}
        {live.status === "error" && (
          <div className="live-status live-status--error">
            <p>
              Couldn't load your playlists — {live.message}. Check them in
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
            <div className="live-status live-status--error">
              <p>
                Couldn't load your playlists —{" "}
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
            <div className="live-status">
              <p>No channels here yet. Add a playlist in Settings → Playlists.</p>
            </div>
          ))}
        {ready && shownChannel && (
          <>
            <Hero
              channel={shownChannel}
              programmes={shownProgrammes}
              programme={preview?.programme ?? undefined}
            />
            {/* Headless: opens mpv into #player-slot and follows the box.
             * Only in Tauri with a real stream URL, so browser/mock is
             * untouched. */}
            {playUrl && (
              <CompositionPlayer
                url={playUrl}
                meta={playMeta}
                fullscreen={fullscreen}
              />
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
