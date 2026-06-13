import { useEffect, useMemo, useState } from "react";
import type { ConfigBlob, EpgProgram } from "@blammytv/shared";
import { NowPlaying } from "../components/NowPlaying";
import { CategorySidebar, FAVORITES_ID } from "../components/CategorySidebar";
import { EpgGuide } from "../components/EpgGuide";
import { isLiveNow } from "../lib/epg";

export function LiveScreen({ config }: { config: ConfigBlob }) {
  const { live, favorites } = config;
  const now = useNow();

  const [categoryId, setCategoryId] = useState(
    () => live.groups[0]?.id ?? FAVORITES_ID,
  );
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(
    null,
  );

  const channels = useMemo(() => {
    if (categoryId === FAVORITES_ID) {
      const favSet = new Set(favorites);
      return live.channels.filter((c) => favSet.has(c.id));
    }
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

  return (
    <div className="live-screen">
      {heroChannel && (
        <NowPlaying channel={heroChannel} program={heroProgram} now={now} />
      )}
      <div className="live-screen__body">
        <CategorySidebar
          groups={live.groups}
          selectedId={categoryId}
          onSelect={(id) => {
            setCategoryId(id);
            setSelectedProgramId(null);
          }}
        />
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
