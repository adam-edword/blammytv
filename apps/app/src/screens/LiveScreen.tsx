import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ConfigBlob, EpgProgram } from "@blammytv/shared";
import { NowPlaying } from "../components/NowPlaying";
import {
  CategorySidebar,
  FAVORITES_ID,
  RECENTS_ID,
} from "../components/CategorySidebar";
import { EpgGuide } from "../components/EpgGuide";
import { isLiveNow } from "../lib/epg";
import { isDesktop, popoutPlay } from "../lib/desktop";

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

export function LiveScreen({ config }: { config: ConfigBlob }) {
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

  const channels = useMemo(() => {
    if (categoryId === FAVORITES_ID) {
      const favSet = new Set(favorites);
      return live.channels.filter((c) => favSet.has(c.id));
    }
    // Recents has no history wired up yet — show an empty guide for now.
    if (categoryId === RECENTS_ID) return [];
    return live.channels.filter((c) => c.groupId === categoryId);
  }, [categoryId, live.channels, favorites]);

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
      if (e.key === "Escape") setTheater(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inTheater]);

  // Pop the current channel into the native mpv window; stop the in-app player.
  const popout = () => {
    const ch = playingChannel ?? heroChannel;
    if (!ch) return;
    void popoutPlay(ch.streamUrl);
    setPlayingId(null);
    setTheater(false);
  };

  // Hovering a guide row previews that channel's current programme in the hero
  // text — the player keeps streaming whatever it was already playing.
  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
  const hoverChannel = hoveredChannelId
    ? live.channels.find((c) => c.id === hoveredChannelId) ?? null
    : null;
  const hoverProgram = hoverChannel
    ? live.programs.find(
        (p) => p.channelId === hoverChannel.id && isLiveNow(p, now),
      ) ?? null
    : null;
  // Resting hero (no hover): the playing channel while streaming, else the
  // selected/featured channel.
  const restChannel = playingChannel ?? heroChannel;
  const restProgram = playingChannel ? playingProgram : heroProgram;
  const textChannel = hoverChannel ?? restChannel;
  const textProgram = hoverChannel ? hoverProgram : restProgram;
  const sourceName = live.groups.find(
    (g) => g.id === (textChannel ?? heroChannel)?.groupId,
  )?.name;

  return (
    <div
      className={"live-screen" + (inTheater ? " live-screen--theater" : "")}
      style={{ "--categories-w": `${panelWidth}px` } as CSSProperties}
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
            onPlay={() => setPlayingId(heroChannel.id)}
            onStop={() => {
              setPlayingId(null);
              setTheater(false);
            }}
            onToggleTheater={() => setTheater((t) => !t)}
            onPopout={isDesktop() ? popout : undefined}
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
