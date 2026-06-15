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
    return (
      live.programs.find(
        (p) => p.channelId === featuredChannelId && isLiveNow(p, now),
      ) ?? null
    );
  }, [selectedProgramId, live.programs, featuredChannelId, now]);

  const heroChannel =
    live.channels.find((c) => c.id === heroProgram?.channelId) ??
    live.channels.find((c) => c.id === featuredChannelId) ??
    live.channels[0];

  // Which channel is actively streaming in the preview. Switching the hero
  // channel stops playback (you re-press play on the new one).
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playing = !!heroChannel && playingId === heroChannel.id;

  // Theater mode: page goes black, EPG hides, player floats as the biggest
  // 16:9 box that fits. A body class lets the global header dim to 30%.
  const [theater, setTheater] = useState(false);
  const inTheater = playing && theater;

  useEffect(() => {
    document.body.classList.toggle("theater-mode", inTheater);
    return () => document.body.classList.remove("theater-mode");
  }, [inTheater]);

  // Pop the current channel into the native mpv window; stop the in-app player.
  const popout = () => {
    if (!heroChannel) return;
    void popoutPlay(heroChannel.streamUrl);
    setPlayingId(null);
    setTheater(false);
  };

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
            channel={heroChannel}
            program={heroProgram}
            now={now}
            playing={playing}
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
          onSelectProgram={(p) => setSelectedProgramId(p.id)}
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
