import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import {
  epgVersion,
  getChannelPrograms,
  requestChannelEpg,
  subscribeEpg,
} from "../lib/epgLazy";
import { loadFavorites, toggleFavorite } from "../lib/favorites";
import { loadRecents, pushRecent } from "../lib/recents";
import {
  isTauri,
  isNativePlayer,
  onCompClosed,
  onCompExpand,
  onCompCollapse,
  onCompFullscreen,
  onCompExitFullscreen,
  onCompPopout,
  onNativeCollapse,
  tauriCompFullscreen,
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

  // The channels in a category (Favorites / Recents / a group). Shared by the
  // rendered list and the sidebar-focus prefetch below.
  // NOTE: prefs.hideNoInfoChannels can't be applied with lazy EPG — we don't
  // know which channels have programmes until their row is viewed.
  const channelsForCategory = useCallback(
    (catId: string): LiveChannel[] => {
      if (catId === FAVORITES_ID)
        return live.channels.filter((c) => favoriteIds.has(c.id));
      if (catId === RECENTS_ID) {
        const byId = new Map(live.channels.map((c) => [c.id, c]));
        return recents
          .map((id) => byId.get(id))
          .filter((c): c is LiveChannel => Boolean(c));
      }
      return live.channels.filter((c) => c.groupId === catId);
    },
    [live.channels, favoriteIds, recents],
  );

  const channels = useMemo(
    () => channelsForCategory(categoryId),
    [channelsForCategory, categoryId],
  );

  // Programmes come from the lazy per-channel EPG store (the guide requests each
  // channel's `get_short_epg` as its row scrolls into view). Re-derive whenever
  // the store updates.
  const epgVer = useSyncExternalStore(subscribeEpg, epgVersion);
  const programs = useMemo(() => {
    void epgVer; // re-read the mutable EPG cache whenever it changes
    const out: EpgProgram[] = [];
    for (const ch of channels) {
      const p = getChannelPrograms(ch.id);
      if (p) out.push(...p);
    }
    return out;
  }, [channels, epgVer]);

  // One time window + per-channel lanes, shared by the guide (rendering) and the
  // remote-navigation cursor below — so the navigable cells are exactly the ones
  // drawn.
  const win = useMemo(() => guideWindow(now), [now]);
  const lanes = useMemo(
    () => buildLanes(channels, programs, win),
    [channels, programs, win],
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

  // Current programme for a channel, from the lazy EPG store (re-reads on epgVer).
  const nowProgram = useCallback(
    (channelId?: string): EpgProgram | null => {
      void epgVer; // re-read the lazy store as a channel's EPG arrives
      if (!channelId) return null;
      return (
        (getChannelPrograms(channelId) ?? []).find((p) => isLiveNow(p, now)) ??
        null
      );
    },
    [now, epgVer],
  );

  // The hero follows the user's selection, falling back to whatever is live on
  // the featured channel.
  const featuredChannelId = live.featuredChannelId ?? live.channels[0]?.id;
  const heroProgram = useMemo<EpgProgram | null>(() => {
    // A selected programme is one the user just picked in the guide (so it's in
    // the current category's lazy programmes).
    if (selectedProgramId) {
      return programs.find((p) => p.id === selectedProgramId) ?? null;
    }
    return nowProgram(selectedChannelId ?? featuredChannelId);
  }, [selectedProgramId, selectedChannelId, featuredChannelId, programs, nowProgram]);

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
    ? nowProgram(playingChannel.id)
    : null;

  // The hero + playing channels can be off-screen (so the guide's row observer
  // won't have requested them) — fetch their EPG so the hero shows "now playing".
  const heroChannelId = heroChannel?.id;
  const playingChannelId = playingChannel?.id;
  useEffect(() => {
    if (heroChannelId) requestChannelEpg(heroChannelId);
  }, [heroChannelId]);
  useEffect(() => {
    if (playingChannelId) requestChannelEpg(playingChannelId);
  }, [playingChannelId]);

  // Theater mode: page goes black, EPG hides, player floats as the biggest
  // 16:9 box that fits. A body class lets the global header dim to 30%.
  const [theater, setTheater] = useState(false);
  const inTheater = playing && theater;

  useEffect(() => {
    // On Android the native player owns fullscreen (it covers the UI), so the
    // React layout must stay put — applying the desktop theater layout would
    // move the hero box, leaving the mini's rect + focus ring stale on collapse.
    if (isNativePlayer()) return;
    document.body.classList.toggle("theater-mode", inTheater);
    return () => document.body.classList.remove("theater-mode");
  }, [inTheater]);

  // Android: the mini player follows theater mode — entering expands it to
  // fullscreen, leaving collapses it back to the hero box (still playing).
  useEffect(() => {
    if (!isNativePlayer() || !playing) return;
    void tauriCompFullscreen(inTheater);
  }, [inTheater, playing]);

  // Android: the native player's Back collapses fullscreen → mini; mirror it so
  // React leaves theater mode (the mini keeps playing).
  useEffect(() => onNativeCollapse(() => setTheater(false)), []);

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
    hoveredProgram ?? (hoverChannel ? nowProgram(hoverChannel.id) : null);
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
  // inside is index-based over the sidebar list, the mini player, and the guide
  // `lanes` (a logical grid), so norigin never runs geometry inside the densely-
  // scrolled guide. Crucially, onArrowPress NEVER returns true — focus is never
  // handed to norigin's geometry from this full-screen node (that lands on
  // whatever's nearest, e.g. the settings button, or vanishes at an edge).
  // Exits upward go to the active tab by name; every other edge stays put.
  type Nav =
    | { zone: "sidebar"; row: number }
    | { zone: "hero" }
    | { zone: "guide"; row: number; col: number }
    | null;
  const [nav, setNav] = useState<Nav>(null);
  const navRef = useRef<Nav>(null);
  navRef.current = nav;
  // "Continue holding to close" scrim on the mini player (set by the hold-to-
  // close key handler below, drawn by NowPlaying).
  const [heroHold, setHeroHold] = useState(false);
  // A hold just closed the mini and moved the cursor onto a guide row, but OK is
  // still physically down — swallow the rest of that press so its release/repeat
  // doesn't immediately re-play the channel under the new cursor. Cleared when
  // the key is actually released (mirrors StreamCard's holdConsumed).
  const holdConsumedRef = useRef(false);
  // Whether the current arrow keydown is an OS auto-repeat (held) vs a fresh
  // press — boundary exits into the nav consult this so a held scroll soft-stops
  // at the edge instead of overshooting (set by the capture listener below).
  const arrowRepeatRef = useRef(false);
  // Remember the guide cell so moving sidebar↔guide within a category keeps your
  // place; reset to the top when the category changes (selectCategory).
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
    // A new source starts the timeline at the top, not wherever the last one was.
    lastGuide.current = { row: 0, col: 0 };
  }, []);

  // Land focus on the sources list, on the active category — the natural entry
  // point for the tab (the guide is a step to the right of it).
  const gotoSidebar = useCallback(() => {
    const idx = Math.max(0, navCategories.indexOf(categoryId));
    setNav({ zone: "sidebar", row: idx });
  }, [navCategories, categoryId]);

  // Exit upward: always the active (Live) tab, never a geometric guess. The
  // setFocus blurs this node, which clears `nav`.
  const gotoTabs = useCallback(() => setFocus("tab-live"), []);

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
      // Empty category (empty Favorites/Recents, an empty group): there's no
      // guide to enter. If a channel is up in the mini, land there so Right
      // isn't a dead-end that bounces straight back to the sidebar; otherwise
      // stay put.
      if (heroChannel) setNav({ zone: "hero" });
      else gotoSidebar();
      return;
    }
    moveGuide(lastGuide.current.row, lastGuide.current.col);
  }, [lanes.length, moveGuide, gotoSidebar, heroChannel]);

  const handleArrow = useCallback(
    (dir: string): boolean => {
      // Player owns the keys while in theater/fullscreen — consume without moving
      // (the forward-to-player effect handles them). Never returns true below, so
      // focus can't escape to norigin geometry and get lost.
      if (theaterRef.current || fsRef.current) return false;
      const n = navRef.current;
      if (!n) {
        gotoSidebar();
        return false;
      }

      if (n.zone === "sidebar") {
        if (dir === "up") {
          if (n.row > 0) setNav({ zone: "sidebar", row: n.row - 1 });
          // Top of the list → Live tab, but only on a deliberate press: a held
          // scroll soft-stops at the top instead of blowing through into the nav.
          else if (!arrowRepeatRef.current) gotoTabs();
        } else if (dir === "down") {
          if (n.row < navCategories.length - 1)
            setNav({ zone: "sidebar", row: n.row + 1 });
        } else if (dir === "right") {
          enterGuide(); // sources → timeline (the mini player is up from there)
        }
        // left: nothing to the left — stay put.
        return false;
      }

      if (n.zone === "hero") {
        // Soft-stop: a held scroll up stays on the mini; an intentional press
        // exits to the nav.
        if (dir === "up") {
          if (!arrowRepeatRef.current) gotoTabs();
        } else if (dir === "down") enterGuide();
        else if (dir === "left") gotoSidebar();
        // right: stay.
        return false;
      }

      // guide
      if (lanes.length === 0) {
        // No guide here (empty category) — prefer the mini over a sidebar bounce.
        if (heroChannel) setNav({ zone: "hero" });
        else gotoSidebar();
        return false;
      }
      if (dir === "up") {
        if (n.row > 0) moveGuide(n.row - 1, n.col);
        else if (heroChannel) setNav({ zone: "hero" }); // top row → mini player
        else if (!arrowRepeatRef.current) gotoTabs(); // soft-stop into the nav
      } else if (dir === "down") {
        if (n.row < lanes.length - 1) moveGuide(n.row + 1, n.col);
      } else if (dir === "left") {
        if (n.col > 0) moveGuide(n.row, n.col - 1);
        else gotoSidebar(); // first column → sources
      } else if (dir === "right") {
        if (n.col < colCount(n.row) - 1) moveGuide(n.row, n.col + 1);
      }
      return false;
    },
    [
      gotoSidebar,
      gotoTabs,
      enterGuide,
      moveGuide,
      colCount,
      lanes.length,
      navCategories.length,
      heroChannel,
    ],
  );

  const handleEnter = useCallback(() => {
    if (theaterRef.current || fsRef.current) return;
    if (holdConsumedRef.current) return; // tail of a hold that just closed the mini
    const n = navRef.current;
    if (!n) return;
    if (n.zone === "sidebar") {
      const id = navCategories[n.row];
      if (id) selectCategory(id);
    } else if (n.zone === "hero") {
      // While playing, the raw key handler below distinguishes tap (→ theater)
      // from hold (→ close), so don't act on the norigin keydown here. When the
      // mini is idle, a tap just starts the channel.
      if (!playing && heroChannel) playChannel(heroChannel.id);
    } else {
      const lane = lanes[n.row];
      if (!lane) return;
      const blk = lane.blocks[n.col];
      if (blk) selectProgram(blk.p);
      else selectChannelId(lane.ch.id);
    }
  }, [
    navCategories,
    lanes,
    heroChannel,
    playing,
    selectCategory,
    selectProgram,
    selectChannelId,
  ]);

  // Hold-to-close stops the mini and seats the cursor on that channel's guide
  // row (or just drops into the guide if it isn't in the current category).
  // Captured by ref so the (stable) key listener below always runs the latest.
  const heroClose = () => {
    const id = playingId;
    setPlayingId(null);
    setTheater(false);
    leaveFullscreen();
    const row = id ? lanes.findIndex((l) => l.ch.id === id) : -1;
    if (row >= 0) moveGuide(row, 0);
    else enterGuide();
  };
  const heroCloseRef = useRef(heroClose);
  heroCloseRef.current = heroClose;

  // Mini-player OK: tap → theater, hold ~2s → close (mirrors the Continue
  // Watching card). norigin fires Enter on keydown — too eager for a hold — so
  // time the press from the raw key stream, exactly like StreamCard. Active only
  // while the cursor sits on a *playing* mini and the player isn't full-size.
  useEffect(() => {
    const HINT_MS = 200; // tap-vs-hold boundary; the "hold to close" tab appears
    const HOLD_MS = 2000; // hold this long to close
    const RELEASE_MS = 90; // keyup with no follow-up keydown = released
    let firstDownAt = 0;
    let lastUpAt = 0;
    let closed = false;
    let releaseTimer: number | null = null;
    let hintTimer: number | null = null;
    const cancelRelease = () => {
      if (releaseTimer != null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
    };
    const cancelHint = () => {
      if (hintTimer != null) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }
    };
    const armed = () =>
      navRef.current?.zone === "hero" &&
      playingRef.current &&
      !theaterRef.current &&
      !fsRef.current;

    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !armed()) return;
      cancelRelease();
      if (firstDownAt === 0) {
        firstDownAt = performance.now();
        hintTimer = window.setTimeout(() => setHeroHold(true), HINT_MS);
      }
      if (!closed && performance.now() - firstDownAt >= HOLD_MS) {
        closed = true;
        holdConsumedRef.current = true; // swallow the rest of this press
        cancelHint();
        setHeroHold(false);
        heroCloseRef.current();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      lastUpAt = performance.now();
      cancelRelease();
      releaseTimer = window.setTimeout(() => {
        releaseTimer = null;
        cancelHint();
        setHeroHold(false);
        const held = firstDownAt ? lastUpAt - firstDownAt : 0;
        const wasArmedPress = firstDownAt !== 0;
        const wasClosed = closed;
        firstDownAt = 0;
        closed = false;
        // Physical release is complete — let OK act normally again.
        holdConsumedRef.current = false;
        if (wasClosed) return; // the hold already closed it
        // A tap expands the mini to theater — but only if the press began on an
        // already-playing mini (firstDownAt is only set when armed at keydown).
        // A tap that just started an idle channel must NOT also jump to theater:
        // by release, playback has flipped on so armed() is now true, and held
        // would be 0 (firstDownAt never set), which would wrongly pass.
        if (wasArmedPress && held < HINT_MS && armed()) setTheater(true);
      }, RELEASE_MS);
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      cancelRelease();
      cancelHint();
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, []);

  // Track arrow auto-repeat (held vs fresh press) for the soft-stop boundary
  // exits. Capture phase runs before norigin's handler, so arrowRepeatRef is
  // already up to date when handleArrow consults it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow")) return;
      arrowRepeatRef.current = e.repeat;
      // Any arrow press means an OK-hold is over — clear a possibly-stuck
      // consume flag (e.g. if the hold's keyup was swallowed by the native
      // player), so OK can't end up silently ignored afterward.
      holdConsumedRef.current = false;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const { ref: contentRef } = useFocusable<HTMLDivElement>({
    focusKey: "live-content",
    onArrowPress: handleArrow,
    onEnterPress: handleEnter,
    onFocus: () => {
      if (!navRef.current) gotoSidebar();
    },
    onBlur: () => setNav(null),
  });

  // Land focus in the tab when the Live screen mounts (it remounts on switch) —
  // onFocus then seats the cursor on the sources list.
  useEffect(() => {
    const id = requestAnimationFrame(() => setFocus("live-content"));
    return () => cancelAnimationFrame(id);
  }, []);

  // Clamp the cursor when the category (and thus lanes) changes under it.
  useEffect(() => {
    const n = navRef.current;
    if (n?.zone !== "guide") return;
    if (lanes.length === 0) gotoSidebar();
    else moveGuide(n.row, n.col);
    // React only to lanes changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes]);

  // Drive the hero preview from the remote cursor (mirrors mouse hover). On the
  // hero/sidebar the hero shows its resting channel, so clear the hover preview.
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

  // The cursor's focused ids, handed to the guide/sidebar/hero for the ring.
  const heroFocused = nav?.zone === "hero";
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

  // Prefetch the top rows' EPG of the category the cursor is hovering in the
  // sidebar — so by the time you open it, the first screenful is already there
  // (the rest still stream in on scroll). Debounced: holding up/down through the
  // sidebar would otherwise fire a burst of requests (8 per category passed),
  // and the resulting network + re-render churn is what makes the hold-scroll
  // stutter. Only prefetch once the cursor settles on a category.
  useEffect(() => {
    if (!focusedCategoryId) return;
    const id = window.setTimeout(() => {
      for (const ch of channelsForCategory(focusedCategoryId).slice(0, 8)) {
        requestChannelEpg(ch.id);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [focusedCategoryId, channelsForCategory]);

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

  // On Android the native surface owns fullscreen (it covers the UI), so the
  // React Live layout must stay completely static — the theater/fullscreen
  // classes here reposition .now-playing__preview, and on collapse the rAF can
  // catch that stale theater rect for a frame and shove the native video to it,
  // which is the exit jitter. Desktop keeps the in-page theater layout.
  const nativePlayer = isNativePlayer();
  const theaterLayout = !nativePlayer && inTheater;
  const fullscreenLayout = !nativePlayer && fullscreen;

  return (
    <div
      ref={contentRef}
      className={
        "live-screen" +
        (theaterLayout ? " live-screen--theater" : "") +
        (fullscreenLayout ? " live-screen--fullscreen" : "")
      }
      style={{ "--categories-w": `${panelWidth}px` } as CSSProperties}
      onClick={onBackdropClick}
    >
      <CategorySidebar
        groups={live.groups}
        selectedId={categoryId}
        focusedId={focusedCategoryId}
        collapsed={collapsed || theaterLayout}
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
            focused={heroFocused}
            holdHint={heroHold}
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
