import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ConfigBlob, EpgProgram } from "@blammytv/shared";
import { NowPlaying } from "../components/NowPlaying";
import {
  CategorySidebar,
  FAVORITES_ID,
  RECENTS_ID,
} from "../components/CategorySidebar";
import { EpgGuide } from "../components/EpgGuide";
import { SourceError } from "../components/SourceError";
import { isLiveNow } from "../lib/epg";
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
  const { live, favorites } = config;
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
      const favSet = new Set(favorites);
      list = live.channels.filter((c) => favSet.has(c.id));
    } else if (categoryId === RECENTS_ID) {
      // Recents has no history wired up yet — show an empty guide for now.
      list = [];
    } else {
      list = live.channels.filter((c) => c.groupId === categoryId);
    }
    if (prefs.hideNoInfoChannels) {
      const withInfo = new Set(live.programs.map((p) => p.channelId));
      list = list.filter((c) => withInfo.has(c.id));
    }
    return list;
  }, [categoryId, live, favorites, prefs.hideNoInfoChannels]);

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
  // overlay also handles keys directly for when it holds focus.
  useEffect(() => {
    if (!isTauri()) return;
    const f = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!playingRef.current || !SHORTCUT_KEYS.has(key)) return;
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
        collapsed={collapsed || inTheater}
        onSelect={(id) => {
          setCategoryId(id);
          setSelectedProgramId(null);
          setSelectedChannelId(null);
          setHoveredChannelId(null);
          setHoveredProgram(null);
        }}
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
            onPlay={() => setPlayingId(heroChannel.id)}
            onStop={() => {
              setPlayingId(null);
              setTheater(false);
              leaveFullscreen();
            }}
            onToggleTheater={() => setTheater((t) => !t)}
          />
        )}
        <EpgGuide
          channels={channels}
          programs={live.programs}
          now={now}
          selectedProgramId={selectedProgramId ?? undefined}
          selectedChannelId={selectedChannelId ?? undefined}
          onSelectProgram={(p) => {
            setSelectedProgramId(p.id);
            setSelectedChannelId(null);
            setPlayingId(p.channelId);
          }}
          onSelectChannel={(id) => {
            setSelectedChannelId(id);
            setSelectedProgramId(null);
            setPlayingId(id);
          }}
          onHoverChannel={setHoveredChannelId}
          onHoverProgram={setHoveredProgram}
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
