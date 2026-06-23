import { useEffect, useState, type CSSProperties } from "react";
import type { ShareCode, VodItem, StreamSource } from "@blammytv/shared";
import { SourceCard } from "./SourceCard";
import { ChevronIcon } from "./icons";
import { fetchVodSources, gradientFor, vodBackendConfigured } from "../lib/vod";

/** The source-selection page: a full-bleed backdrop with the title's info on
 * the left and the backend-ranked source list on the right. Used for movies
 * and for a chosen series episode (with a Season/Episode context line).
 *
 * Sources are resolved on-demand: when this opens it asks the backend for the
 * ranked list for `sourceKind`/`sourceId` (a movie id, or an episode's
 * `tt…:s:e`). In demo mode it just renders `fallbackSources` from the blob. */
export function SourceSelector({
  item,
  shareCode,
  sourceKind,
  sourceId,
  fallbackSources = [],
  episodeLabel = null,
  episodeTitle = null,
  onBack,
}: {
  item: VodItem;
  shareCode: ShareCode;
  sourceKind: VodItem["kind"];
  sourceId: string;
  fallbackSources?: StreamSource[];
  episodeLabel?: string | null;
  episodeTitle?: string | null;
  onBack: () => void;
}) {
  // null = still resolving; [] = resolved but nothing available.
  const [sources, setSources] = useState<StreamSource[] | null>(
    vodBackendConfigured() ? null : fallbackSources,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!vodBackendConfigured()) {
      setSources(fallbackSources);
      return;
    }
    let alive = true;
    setSources(null);
    setFailed(false);
    fetchVodSources(shareCode, sourceKind, sourceId)
      .then((s) => alive && setSources(s))
      .catch(() => {
        if (alive) {
          setSources([]);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
    // fallbackSources is stable per screen; resolution keys off id/kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareCode, sourceKind, sourceId]);

  // Backspace / Escape backs out — natural on a remote and a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const backdrop = item.backdrop ?? item.poster;
  const backdropStyle: CSSProperties = backdrop
    ? { backgroundImage: `url(${backdrop})` }
    : { background: gradientFor(item.id) };

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
          {sources === null ? (
            <p className="detail__no-sources">Finding sources…</p>
          ) : sources.length === 0 ? (
            <p className="detail__no-sources">
              {failed ? "Couldn't load sources." : "No sources available."}
            </p>
          ) : (
            sources.map((s) => <SourceCard key={s.id} source={s} />)
          )}
        </aside>
      </div>
    </div>
  );
}
