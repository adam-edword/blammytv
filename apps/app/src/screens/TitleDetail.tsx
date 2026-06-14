import { useEffect, useState, type CSSProperties } from "react";
import type { VodItem, Episode, StreamSource } from "@blammytv/shared";
import { SourceCard } from "../components/SourceCard";
import { EpisodeBrowser } from "../components/EpisodeBrowser";
import { ChevronIcon } from "../components/icons";
import { gradientFor } from "../lib/vod";

/** Title detail. Movies go straight to the source selector. Series first show
 * the episode browser (grid); once an episode is picked it drops into the same
 * source selector, scoped to that episode. */
export function TitleDetail({
  item,
  onBack,
}: {
  item: VodItem;
  onBack: () => void;
}) {
  const isSeries = item.seasons.length > 0;
  const [picked, setPicked] = useState<{
    episode: Episode;
    seasonNumber: number;
  } | null>(null);

  const backdrop = item.backdrop ?? item.poster;
  const backdropStyle: CSSProperties = backdrop
    ? { backgroundImage: `url(${backdrop})` }
    : { background: gradientFor(item.id) };

  if (isSeries && !picked) {
    return (
      <div className="detail">
        <div className="detail__backdrop" style={backdropStyle} />
        <div className="detail__scrim detail__scrim--series" />
        <EpisodeBrowser
          item={item}
          onBack={onBack}
          onPick={(episode, seasonNumber) =>
            setPicked({ episode, seasonNumber })
          }
        />
      </div>
    );
  }

  // Source selector — for a movie, or for a chosen episode of a series.
  const sources: StreamSource[] = picked ? picked.episode.sources : item.sources;
  const episodeLabel = picked
    ? `Season ${picked.seasonNumber} · Episode ${picked.episode.number}`
    : null;
  const back = picked ? () => setPicked(null) : onBack;

  return (
    <SourceSelector
      item={item}
      backdropStyle={backdropStyle}
      sources={sources}
      episodeLabel={episodeLabel}
      episodeTitle={picked?.episode.title ?? null}
      onBack={back}
    />
  );
}

function SourceSelector({
  item,
  backdropStyle,
  sources,
  episodeLabel,
  episodeTitle,
  onBack,
}: {
  item: VodItem;
  backdropStyle: CSSProperties;
  sources: StreamSource[];
  episodeLabel: string | null;
  episodeTitle: string | null;
  onBack: () => void;
}) {
  // Backspace / Escape backs out — natural on a remote and a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const meta = [
    item.year,
    item.runtimeMin ? `${item.runtimeMin} min` : null,
    item.kind === "series" ? "Series" : "Movie",
    item.rating != null ? `★ ${item.rating.toFixed(1)}/10` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  return (
    <div className="detail">
      <div className="detail__backdrop" style={backdropStyle} />
      <div className="detail__scrim" />

      <div className="detail__body">
        <button className="detail__back" type="button" onClick={onBack}>
          <ChevronIcon className="detail__back-icon" />
          Back
        </button>

        <div className="detail__info">
          <h1 className="detail__title">{item.title}</h1>
          {episodeLabel && (
            <p className="detail__episode">
              <span className="detail__episode-label">{episodeLabel}</span>
              {episodeTitle && (
                <span className="detail__episode-title">{episodeTitle}</span>
              )}
            </p>
          )}
          {item.synopsis && <p className="detail__synopsis">{item.synopsis}</p>}
          <p className="detail__meta">{meta}</p>

          {item.genres.length > 0 && (
            <div className="detail__group">
              <span className="detail__label">Genres</span>
              <div className="pill-row">
                {item.genres.map((g) => (
                  <span key={g} className="pill">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {item.cast.length > 0 && (
            <div className="detail__group">
              <span className="detail__label">Cast</span>
              <div className="pill-row">
                {item.cast.map((c, i) => (
                  <span key={i} className="pill">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="detail__rail" aria-label="Sources">
          {sources.length === 0 ? (
            <p className="detail__no-sources">No sources available.</p>
          ) : (
            sources.map((s) => <SourceCard key={s.id} source={s} />)
          )}
        </aside>
      </div>
    </div>
  );
}
