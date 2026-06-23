import { useEffect, useMemo, useState } from "react";
import type { Episode, ShareCode, StreamSource, VodItem } from "@blammytv/shared";
import type { TheaterMeta } from "./Player";
import { SourceCard } from "./SourceCard";
import { EpisodeCard } from "./EpisodeCard";
import { CloseIcon, ChevronIcon } from "./icons";
import { fetchVodSources } from "../lib/vod";

type Pick = (
  url: string,
  meta: TheaterMeta,
  ctx: { item: VodItem; episodeId?: string },
) => void;

/**
 * The in-player episodes/sources panel (slides in beside the shrunk video).
 * Reuses the title screen's EpisodeCard / SourceCard so it matches.
 *
 * - Movie: lists the title's sources; pick one to switch the stream in place.
 * - Series: season picker + episode list; picking an episode plays its
 *   top-ranked source. (Per-episode source picking can follow.)
 */
export function SourcePanel({
  item,
  shareCode,
  currentUrl,
  currentEpisodeId,
  onPick,
  onClose,
}: {
  item: VodItem;
  shareCode: ShareCode;
  currentUrl: string;
  currentEpisodeId?: string;
  onPick: Pick;
  onClose: () => void;
}) {
  const isSeries = item.kind === "series" && item.seasons.length > 0;

  return (
    <aside className="src-panel" data-interactive>
      <header className="src-panel__head">
        <span className="src-panel__title">
          {isSeries ? "Episodes" : "Sources"}
        </span>
        <button
          className="src-panel__close"
          type="button"
          aria-label="Close panel"
          onClick={onClose}
        >
          <CloseIcon size={20} />
        </button>
      </header>

      {isSeries ? (
        <SeriesBody
          item={item}
          shareCode={shareCode}
          currentEpisodeId={currentEpisodeId}
          onPick={onPick}
        />
      ) : (
        <MovieBody
          item={item}
          shareCode={shareCode}
          currentUrl={currentUrl}
          onPick={onPick}
        />
      )}
    </aside>
  );
}

/** Build the player meta for a switched source/episode. */
function playMeta(
  item: VodItem,
  source: StreamSource,
  episode?: Episode,
): TheaterMeta {
  return {
    logo: item.logo,
    backdrop: item.backdrop ?? item.poster,
    channelName: [
      item.year,
      item.kind === "series" ? "Series" : "Movie",
      `${source.quality}${source.cached ? " ⚡" : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
    title: episode ? `${item.title} — ${episode.title}` : item.title,
    description: item.synopsis,
    progressPct: 0,
    live: false,
    kind: "vod",
  };
}

function MovieBody({
  item,
  shareCode,
  currentUrl,
  onPick,
}: {
  item: VodItem;
  shareCode: ShareCode;
  currentUrl: string;
  onPick: Pick;
}) {
  const [sources, setSources] = useState<StreamSource[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchVodSources(shareCode, "movie", item.id)
      .then((s) => alive && setSources(s))
      .catch(() => alive && setSources([]));
    return () => {
      alive = false;
    };
  }, [shareCode, item.id]);

  if (sources === null)
    return <p className="src-panel__note">Finding sources…</p>;
  if (sources.length === 0)
    return <p className="src-panel__note">No sources available.</p>;

  return (
    <div className="src-panel__list">
      {sources.map((s) => (
        <div
          key={s.id}
          className={
            "src-panel__item" + (s.streamUrl === currentUrl ? " is-current" : "")
          }
        >
          <SourceCard
            source={s}
            onPlay={() => onPick(s.streamUrl, playMeta(item, s), { item })}
          />
        </div>
      ))}
    </div>
  );
}

function SeriesBody({
  item,
  shareCode,
  currentEpisodeId,
  onPick,
}: {
  item: VodItem;
  shareCode: ShareCode;
  currentEpisodeId?: string;
  onPick: Pick;
}) {
  const initialSeason = useMemo(() => {
    const i = item.seasons.findIndex((s) =>
      s.episodes.some((e) => e.id === currentEpisodeId),
    );
    return i >= 0 ? i : 0;
  }, [item.seasons, currentEpisodeId]);

  const [seasonIdx, setSeasonIdx] = useState(initialSeason);
  const [busy, setBusy] = useState(false);
  const season = item.seasons[seasonIdx];

  const play = async (ep: Episode) => {
    if (busy) return;
    setBusy(true);
    try {
      const sources = await fetchVodSources(shareCode, "series", ep.id);
      const top = sources[0];
      if (top)
        onPick(top.streamUrl, playMeta(item, top, ep), {
          item,
          episodeId: ep.id,
        });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="src-panel__seasons">
        <button
          className="src-panel__season-nav"
          type="button"
          aria-label="Previous season"
          disabled={seasonIdx === 0}
          onClick={() => setSeasonIdx((i) => Math.max(0, i - 1))}
        >
          <ChevronIcon />
        </button>
        <span className="src-panel__season-name">
          {season?.name ?? `Season ${season?.number ?? ""}`}
        </span>
        <button
          className="src-panel__season-nav src-panel__season-nav--next"
          type="button"
          aria-label="Next season"
          disabled={seasonIdx >= item.seasons.length - 1}
          onClick={() =>
            setSeasonIdx((i) => Math.min(item.seasons.length - 1, i + 1))
          }
        >
          <ChevronIcon />
        </button>
      </div>

      {busy && <p className="src-panel__note">Loading source…</p>}

      <div className="src-panel__list">
        {season?.episodes.map((ep) => (
          <div
            key={ep.id}
            className={
              "src-panel__item" +
              (ep.id === currentEpisodeId ? " is-current" : "")
            }
          >
            <EpisodeCard episode={ep} onClick={() => void play(ep)} />
          </div>
        ))}
      </div>
    </>
  );
}
