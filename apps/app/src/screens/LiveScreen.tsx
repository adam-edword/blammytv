import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  setFocus,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import type { ConfigBlob, EpgProgram, LiveChannel } from "@blammytv/shared";
import { NowPlaying } from "../components/NowPlaying";
import {
  CategorySidebar,
  FAVORITES_ID,
  RECENTS_ID,
} from "../components/CategorySidebar";
import { EpgGuide } from "../components/EpgGuide";
import { SourceError } from "../components/SourceError";
import { guideWindow, isLiveNow } from "../lib/epg";
import { buildLanes, laneColumns } from "../lib/guide";
import { loadFavorites, toggleFavorite } from "../lib/favorites";
import { loadRecents, pushRecent } from "../lib/recents";
import { usePreferences } from "../state/preferences";
import {
  isTauri,
  onCompClosed,
  onCompExpand,
  onCompCollapse,
  onCompFullscreen,
  onCompExitFullscreen,
  onCompPopout,
  tauriCompPopout,
  tauriSetFullscreen,
  tauriCompKey,
} from "../lib/tauri";

// YouTube-style shortcut keys we forward to the native overlay while playing.
const SHORTCUT_KEYS = new Set([
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

// Resizable source panel. Dragged below CAT_COLLAPSE_AT it snaps to a narrow
// emoji rail. Width is remembered per device.
const CAT_MIN = 72;
const CAT_MAX = 560;
const CAT_DEFAULT = 400;
const CAT_COLLAPSE_AT = 168;
const CAT_COLLAPSED_W = 76;
const CAT_STORAGE = "blammytv.categoriesWidth";

function loadCatWidth(): number {
  try {
    const n = parseFloat(localStorage.getItem(CAT_STORAGE) ?? "");
    return Number.isFinite(n) ? Math.min(CAT_MAX, Math.max(CAT_MIN, n)) : CAT_DEFAULT;
  } catch {
    return CAT_DEFAULT;
  }
}

export function LiveScreen({
  config,
  error,
  onRetry,
}: {
  config: ConfigBlob;
  /** Set when the IPTV playlists failed to load (independent of Stream). */
  error?: string;
  onRetry: () => void;
}) {
  const { live } = config;
  // Favorites + recents live on-device (not in the config blob).
  const [favorites, setFavorites] = useState(loadFavorites);
  const [recents, setRecents] = useState(loadRecents);
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  const onToggleFavorite = (id: string) => setFavorites(toggleFavorite(id));
  const now = useNow();

  const [categoryId, setCategoryId] = useState(
    () => live.groups[0]?.id ?? FAVORITES_ID,
  );
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(
    null,
  );
  // A channel selected directly (e.g. an EPG-less "no info" card), used when
  // there's no programme to select.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );

  // Source-panel resize.
  const [catWidth, setCatWidth] = useState(loadCatWidth);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ x: 0, w: 0 });
  const collapsed = catWidth < CAT_COLLAPSE_AT;
  const panelWidth = collapsed ? CAT_COLLAPSED_W : catWidth;

  useEffect(() => {
    try {
      localStorage.setItem(CAT_STORAGE, String(catWidth));
    } catch {
      /* storage unavailable */
    }
  }, [catWidth]);

  const onResizeDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, w: catWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const next = dragRef.current.w + (e.clientX - dragRef.current.x);
    setCatWidth(Math.min(CAT_MAX, Math.max(CAT_MIN, next)));
  };
  const onResizeUp = (e: React.PointerEvent) => {
    setResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const { prefs } = usePreferences();
  const channels = useMemo(() => {
    let list: typeof live.channels;
    if (categoryId === FAVORITES_ID) {
      list = live.channels.filter((c) => favoriteIds.has(c.id));
    } else if (categoryId === RECENTS_ID) {
      // Most-recent-first; map the stored ids back to channels, dropping any
      // that no longer exist.
      const byId = new Map(live.channels.map((c) => [c.id, c]));
      list = recents
        .map((id) => byId.get(id))
        .filter((c): c is LiveChannel => Boolean(c));
    } else {
      list = live.channels.filter((c) => c.groupId === categoryId);
    }
    if (prefs.hideNoInfoChannels) {
      const withInfo = new Set(live.programs.map((p) => p.channelId));
      list = list.filter((c) => withInfo.has(c.id));
    }
    return list;
  }, [categoryId, live, favoriteIds, recents, prefs.hideNoInfoChannels]);

  // One time window + per-channel lanes, shared by the guide (rendering) and the
  // remote-navigation cursor below — so the navigable cells are exactly the ones
  // drawn.
  const win = useMemo(() => guideWindow(now), [now]);
  const lanes = useMemo(
    () => buildLanes(channels, live.programs, win),
    [channels, live.programs, win],
  );

  // Ordered, remote-navigable category list (mirrors the sidebar order, minus
  // the source-folder toggle, which is a pointer-only affordance).
  const navCategories = useMemo(
    () => [
      FAVORITES_ID,
      RECENTS_ID,
      ...live.groups
        .filter((g) => !g.hidden)
        .sort((a, b) => a.order - b.order)
        .map((g) => g.id),
    ],
    [live.groups],
  );

  // The hero follows the user's selection, falling back to whatever is live on
  // the featured channel.
  const featuredChannelId = live.featuredChannelId ?? live.channels[0]?.id;
  const heroProgram = useMemo<EpgProgram | null>(() => {
    if (selectedProgramId) {
      return live.programs.find((p) => p.id === selectedProgramId) ?? null;
    }
    const channelId = selectedChannelId ?? featuredChannelId;
    return (
      live.programs.find(
        (p) => p.channelId === channelId && isLiveNow(p, now),
      ) ?? null
    );
  }, [selectedProgramId, selectedChannelId, live.programs, featuredChannelId, now]);

  const heroChannel =
    (selectedChannelId
      ? live.channels.find((c) => c.id === selectedChannelId)
      : null) ??
    live.channels.find((c) => c.id === heroProgram?.channelId) ??
    live.channels.find((c) => c.id === featuredChannelId) ??
    live.channels[0];

  // The channel actively streaming in the preview, resolved across *all*
  // channels (not just the current category) so browsing the rail never
  // interrupts playback.
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Start a channel and record it in the recents list.
  const playChannel = (id: string) => {
    setPlayingId(id);
    setRecents(pushRecent(id));
  };
  const playingChannel = playingId
    ? live.channels.find((c) => c.id === playingId) ?? null
    : null;
  const playing = !!playingChannel;
  const playingProgram = playingChannel
    ? live.programs.find(
        (p) => p.channelId === playingChannel.id && isLiveNow(p, now),
      ) ?? null
    : null;

  // Theater mode: page goes black, EPG hides, player floats as the biggest
  // 16:9 box that fits. A body class lets the global header dim to 30%.
  const [theater, setTheater] = useState(false);
  const inTheater = playing && theater;

  useEffect(() => {
    document.body.classList.toggle("theater-mode", inTheater);
    return () => document.body.classList.remove("theater-mode");
  }, [inTheater]);

  // Escape leaves theater and drops back to the mini player — playback keeps
  // running.
  useEffect(() => {
    if (!inTheater) return;
    const onKey = (e: KeyboardEvent) => {
      // While fullscreen, let Escape exit fullscreen (back to theater) first;
      // a second Escape then leaves theater.
      if (e.key === "Escape" && !document.fullscreenElement) setTheater(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inTheater]);

  // Tauri: mirror the native overlay's actions in React. ✕ stops (back to guide);
  // mini click expands to theater; theater ✕ collapses to mini; the fullscreen
  // button takes the OS window edge-to-edge, exit steps back to theater.
  const [fullscreen, setFullscreen] = useState(false);
  const leaveFullscreen = () => {
    setFullscreen(false);
    tauriSetFullscreen(false);
  };
  useEffect(
    () =>
      onCompClosed(() => {
        setPlayingId(null);
        setTheater(false);
        leaveFullscreen();
      }),
    [],
  );
  useEffect(() => onCompExpand(() => setTheater(true)), []);
  useEffect(
    () =>
      onCompCollapse(() => {
        setTheater(false);
        leaveFullscreen();
      }),
    [],
  );
  useEffect(
    () =>
      onCompFullscreen(() => {
        setFullscreen(true);
        tauriSetFullscreen(true);
      }),
    [],
  );
  useEffect(() => onCompExitFullscreen(leaveFullscreen), []);
  // YouTube-style shortcuts: the main webview holds keyboard focus, so capture
  // here and forward to the native overlay (which drives mpv + its UI). The
  // overlay also handles keys directly for when it holds focus. Only while the
  // player owns the screen (theater/fullscreen) — in mini mode the arrows belong
  // to the guide cursor, so the remote can keep browsing while a channel plays.
  useEffect(() => {
    if (!isTauri()) return;
    const f = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!playingRef.current || !SHORTCUT_KEYS.has(key)) return;
      if (!theaterRef.current && !fsRef.current) return;
      e.preventDefault();
      void tauriCompKey(key).catch(() => {});
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  // Scroll over the player = volume. Only when the wheel lands on the preview box
  // (so the EPG keeps its own scroll). Covers the case where the wheel reaches the
  // main webview; the native child handles it when "scroll inactive windows" is on.
  useEffect(() => {
    if (!isTauri()) return;
    const onWheel = (e: WheelEvent) => {
      if (!playingRef.current) return;
      const t = e.target as Element | null;
      if (!t || !t.closest(".now-playing__preview")) return;
      e.preventDefault();
      void tauriCompKey(e.deltaY < 0 ? "ArrowUp" : "ArrowDown").catch(() => {});
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  // Pop the current stream into mpv's own floating window; close the in-app player.
  useEffect(
    () =>
      onCompPopout(() => {
        void tauriCompPopout(streamUrlRef.current).catch(() => {});
        setPlayingId(null);
        setTheater(false);
        leaveFullscreen();
      }),
    [],
  );

  // Hovering a guide row previews that channel's current programme in the hero
  // text — the player keeps streaming whatever it was already playing.
  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
  // The exact programme card under the cursor (a future one too), if any.
  const [hoveredProgram, setHoveredProgram] = useState<EpgProgram | null>(null);
  // Channel being previewed: the hovered card's channel wins, else the row.
  const hoverChannel = (() => {
    const id = hoveredProgram?.channelId ?? hoveredChannelId;
    return id ? live.channels.find((c) => c.id === id) ?? null : null;
  })();
  // The previewed programme: the hovered card, else the channel's current show.
  const hoverProgram =
    hoveredProgram ??
    (hoverChannel
      ? live.programs.find(
          (p) => p.channelId === hoverChannel.id && isLiveNow(p, now),
        ) ?? null
      : null);
  // Resting hero (no hover): the playing channel while streaming, else the
  // selected/featured channel.
  const restChannel = playingChannel ?? heroChannel;
  const restProgram = playingChannel ? playingProgram : heroProgram;
  // Live stream URL for native-overlay actions (popout) fired from static effects.
  const streamUrlRef = useRef("");
  streamUrlRef.current = (playingChannel ?? heroChannel)?.streamUrl ?? "";
  // Whether the native player is active — so shortcut keys only fire while playing.
  const playingRef = useRef(false);
  playingRef.current = playing;
  const textChannel = hoverChannel ?? restChannel;
  const textProgram = hoverChannel ? hoverProgram : restProgram;
  const sourceName = live.groups.find(
    (g) => g.id === (textChannel ?? heroChannel)?.groupId,
  )?.name;

  // ─── Remote navigation ────────────────────────────────────────────────────
  // A single norigin node bridges the header tabs to this content; every move
  // inside is index-based over `lanes` (a logical grid) and the sidebar list, so
  // norigin never runs geometry inside the densely-scrolled guide. onArrowPress
  // returns false to consume a move that stays inside, true at an edge to let
  // the header tabs take focus.
  type Nav =
    | { zone: "sidebar"; row: number }
    | { zone: "guide"; row: number; col: number }
    | null;
  const [nav, setNav] = useState<Nav>(null);
  const navRef = useRef<Nav>(null);
  navRef.current = nav;
  // Remember the guide cell so leaving and returning lands where you were.
  const lastGuide = useRef({ row: 0, col: 0 });
  // Read in event handlers: while the player owns the screen (theater /
  // fullscreen), arrows drive the player (below), not the guide cursor.
  const theaterRef = useRef(false);
  theaterRef.current = inTheater;
  const fsRef = useRef(false);
  fsRef.current = fullscreen;

  // Selection actions, shared by pointer (guide/sidebar props) and remote (Enter).
  // playChannel only touches stable setters, so empty deps are safe.
  const selectProgram = useCallback((p: EpgProgram) => {
    setSelectedProgramId(p.id);
    setSelectedChannelId(null);
    playChannel(p.channelId);
  }, []);
  const selectChannelId = useCallback((id: string) => {
    setSelectedChannelId(id);
    setSelectedProgramId(null);
    playChannel(id);
  }, []);
  const selectCategory = useCallback((id: string) => {
    setCategoryId(id);
    setSelectedProgramId(null);
    setSelectedChannelId(null);
    setHoveredChannelId(null);
    setHoveredProgram(null);
  }, []);

  const colCount = useCallback(
    (row: number) => (lanes[row] ? laneColumns(lanes[row]) : 1),
    [lanes],
  );
  const moveGuide = useCallback(
    (row: number, col: number) => {
      const r = Math.max(0, Math.min(lanes.length - 1, row));
      const c = Math.max(0, Math.min(colCount(r) - 1, col));
      lastGuide.current = { row: r, col: c };
      setNav({ zone: "guide", row: r, col: c });
    },
    [lanes.length, colCount],
  );
  const enterGuide = useCallback(() => {
    if (lanes.length === 0) {
      setNav({ zone: "sidebar", row: 0 });
      return;
    }
    moveGuide(lastGuide.current.row, lastGuide.current.col);
  }, [lanes.length, moveGuide]);

  const handleArrow = useCallback(
    (dir: string): boolean => {
      // Player owns the keys while in theater/fullscreen — consume without moving
      // (the forward-to-player effect handles them).
      if (theaterRef.current || fsRef.current) return false;
      const n = navRef.current;
      if (!n) {
        enterGuide();
        return false;
      }
      if (n.zone === "sidebar") {
        if (dir === "up") {
          if (n.row > 0) {
            setNav({ zone: "sidebar", row: n.row - 1 });
            return false;
          }
          return true; // up off the top → header tabs
        }
        if (dir === "down") {
          if (n.row < navCategories.length - 1)
            setNav({ zone: "sidebar", row: n.row + 1 });
          return false;
        }
        if (dir === "right") {
          enterGuide();
          return false;
        }
        return true; // left: nothing further left
      }
      // guide
      if (lanes.length === 0) return true;
      if (dir === "up") {
        if (n.row > 0) {
          moveGuide(n.row - 1, n.col);
          return false;
        }
        return true; // up off the top row → header tabs
      }
      if (dir === "down") {
        if (n.row < lanes.length - 1) moveGuide(n.row + 1, n.col);
        return false;
      }
      if (dir === "left") {
        if (n.col > 0) moveGuide(n.row, n.col - 1);
        else {
          const idx = Math.max(0, navCategories.indexOf(categoryId));
          setNav({ zone: "sidebar", row: idx });
        }
        return false;
      }
      if (dir === "right") {
        if (n.col < colCount(n.row) - 1) moveGuide(n.row, n.col + 1);
        return false;
      }
      return false;
    },
    [enterGuide, moveGuide, colCount, lanes.length, navCategories, categoryId],
  );

  const handleEnter = useCallback(() => {
    if (theaterRef.current || fsRef.current) return;
    const n = navRef.current;
    if (!n) return;
    if (n.zone === "sidebar") {
      const id = navCategories[n.row];
      if (id) selectCategory(id);
      return;
    }
    const lane = lanes[n.row];
    if (!lane) return;
    const blk = lane.blocks[n.col];
    if (blk) selectProgram(blk.p);
    else selectChannelId(lane.ch.id);
  }, [navCategories, lanes, selectCategory, selectProgram, selectChannelId]);

  const { ref: contentRef } = useFocusable<HTMLDivElement>({
    focusKey: "live-content",
    onArrowPress: handleArrow,
    onEnterPress: handleEnter,
    onFocus: () => {
      if (!navRef.current) enterGuide();
    },
    onBlur: () => setNav(null),
  });

  // Land focus in the guide when the Live tab mounts (it remounts on switch).
  useEffect(() => {
    const id = requestAnimationFrame(() => setFocus("live-content"));
    return () => cancelAnimationFrame(id);
  }, []);

  // Clamp the cursor when the category (and thus lanes) changes under it.
  useEffect(() => {
    const n = navRef.current;
    if (n?.zone !== "guide") return;
    if (lanes.length === 0) setNav({ zone: "sidebar", row: 0 });
    else moveGuide(n.row, n.col);
    // React only to lanes changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes]);

  // Drive the hero preview from the remote cursor (mirrors mouse hover).
  useEffect(() => {
    if (nav?.zone === "guide") {
      const lane = lanes[nav.row];
      if (lane) {
        const blk = lane.blocks[nav.col] ?? null;
        setHoveredChannelId(lane.ch.id);
        setHoveredProgram(blk ? blk.p : null);
      }
    } else {
      setHoveredChannelId(null);
      setHoveredProgram(null);
    }
  }, [nav, lanes]);

  // The cursor's focused ids, handed to the guide for the ring + scroll-in.
  const focusedLane = nav?.zone === "guide" ? lanes[nav.row] : undefined;
  const focusedBlock =
    nav?.zone === "guide" && focusedLane
      ? focusedLane.blocks[nav.col]
      : undefined;
  const focusedProgramId = focusedBlock?.p.id;
  const focusedChannelId =
    focusedLane && !focusedBlock ? focusedLane.ch.id : undefined;
  const focusedCategoryId =
    nav?.zone === "sidebar" ? navCategories[nav.row] : undefined;

  // In theater (not fullscreen), clicking the black area outside the player drops
  // back to the mini player + guide. The native overlay swallows clicks on the
  // player box itself, so anything React sees here is genuinely "outside".
  const onBackdropClick = (e: React.MouseEvent) => {
    if (!inTheater || fullscreen) return;
    const t = e.target as Element | null;
    if (t && t.closest(".now-playing__preview")) return;
    setTheater(false);
  };

  // IPTV failed to load — scoped to this tab; Stream is unaffected.
  if (error) return <SourceError message={error} onRetry={onRetry} />;

  return (
    <div
      ref={contentRef}
      className={
        "live-screen" +
        (inTheater ? " live-screen--theater" : "") +
        (fullscreen ? " live-screen--fullscreen" : "")
      }
      style={{ "--categories-w": `${panelWidth}px` } as CSSProperties}
      onClick={onBackdropClick}
    >
      <CategorySidebar
        groups={live.groups}
        selectedId={categoryId}
        focusedId={focusedCategoryId}
        collapsed={collapsed || inTheater}
        onSelect={selectCategory}
      />
      <div
        className={"cat-resize" + (resizing ? " cat-resize--active" : "")}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize source panel"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
      />
      <div className="live-screen__main">
        {heroChannel && (
          <NowPlaying
            channel={textChannel ?? heroChannel}
            program={textProgram}
            now={now}
            playing={playing}
            streamUrl={(playingChannel ?? heroChannel).streamUrl}
            sourceName={sourceName}
            theater={inTheater}
            fullscreen={fullscreen}
            onPlay={() => playChannel(heroChannel.id)}
            onStop={() => {
              setPlayingId(null);
              setTheater(false);
              leaveFullscreen();
            }}
            onToggleTheater={() => setTheater((t) => !t)}
          />
        )}
        <EpgGuide
          lanes={lanes}
          win={win}
          now={now}
          selectedProgramId={selectedProgramId ?? undefined}
          selectedChannelId={selectedChannelId ?? undefined}
          focusedProgramId={focusedProgramId}
          focusedChannelId={focusedChannelId}
          onSelectProgram={selectProgram}
          onSelectChannel={selectChannelId}
          onHoverChannel={setHoveredChannelId}
          onHoverProgram={setHoveredProgram}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </div>
  );
}

/** Ticks every 30s so the now-indicator and progress bars stay honest. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
