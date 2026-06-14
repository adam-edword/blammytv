import { useEffect, type CSSProperties } from "react";
import type { VodItem } from "@blammytv/shared";
import { SourceCard } from "../components/SourceCard";
import { ChevronIcon } from "../components/icons";
import { gradientFor } from "../lib/vod";

/** The title detail / source-selection page. A full-bleed backdrop with the
 * title's info on the left and the backend-ranked source list on the right.
 * (Season/episode selection for series will slot in above the rail later.) */
export function TitleDetail({
  item,
  onBack,
}: {
  item: VodItem;
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
          {item.sources.length === 0 ? (
            <p className="detail__no-sources">No sources available.</p>
          ) : (
            item.sources.map((s) => <SourceCard key={s.id} source={s} />)
          )}
        </aside>
      </div>
    </div>
  );
}
