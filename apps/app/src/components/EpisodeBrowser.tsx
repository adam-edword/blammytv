import { useMemo, useState, type CSSProperties } from "react";
import type { VodItem, Episode } from "@blammytv/shared";
import { EpisodeCard } from "./EpisodeCard";
import { ChevronIcon } from "./icons";
import { gradientFor } from "../lib/vod";

/** Series episode browser (Design 2): a compact title header, a season control
 * bar (prev/next + dropdown + search), and a full-width grid of episodes.
 * Picking one hands the chosen episode + season number up to the source view. */
export function EpisodeBrowser({
  item,
  onBack,
  onPick,
}: {
  item: VodItem;
  onBack: () => void;
  onPick: (episode: Episode, seasonNumber: number) => void;
}) {
  const seasons = item.seasons;
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");

  const season = seasons[seasonIdx];

  const episodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return season.episodes;
    return season.episodes.filter(
      (ep) =>
        ep.title.toLowerCase().includes(q) || String(ep.number).includes(q),
    );
  }, [season, query]);

  const meta = [
    item.year,
    item.kind === "series" ? "Series" : "Movie",
    item.rating != null ? `★ ${item.rating.toFixed(1)}/10` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const selectSeason = (i: number) => {
    setSeasonIdx(i);
    setMenuOpen(false);
    setQuery("");
  };

  const backdrop = item.backdrop ?? item.poster;
  const backdropStyle: CSSProperties = backdrop
    ? { backgroundImage: `url(${backdrop})` }
    : { background: gradientFor(item.id) };

  return (
    <div className="detail">
      <div className="detail__backdrop" style={backdropStyle} />
      <div className="detail__scrim detail__scrim--series" />
      <div className="series">
      <button className="detail__back" type="button" onClick={onBack}>
        <ChevronIcon className="detail__back-icon" />
        Back
      </button>

      <header className="series__header">
        <div className="series__title-block">
          <h1 className="detail__title series__title">{item.title}</h1>
          {item.synopsis && (
            <p className="detail__synopsis">{item.synopsis}</p>
          )}
          <p className="detail__meta">{meta}</p>
        </div>

        <div className="series__tags">
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
                {item.cast.slice(0, 6).map((c, i) => (
                  <span key={i} className="pill">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="season-bar">
        <button
          className="season-bar__nav"
          type="button"
          aria-label="Previous season"
          disabled={seasonIdx === 0}
          onClick={() => selectSeason(Math.max(0, seasonIdx - 1))}
        >
          <ChevronIcon className="season-bar__nav-icon season-bar__nav-icon--prev" />
        </button>

        <div className="season-bar__select-wrap">
          <button
            className="season-bar__select"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {season.name ?? `Season ${season.number}`}
            <ChevronIcon className="season-bar__caret" />
          </button>
          {menuOpen && (
            <ul className="season-bar__menu" role="listbox">
              {seasons.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === seasonIdx}
                    className={
                      "season-bar__option" +
                      (i === seasonIdx ? " season-bar__option--active" : "")
                    }
                    onClick={() => selectSeason(i)}
                  >
                    {s.name ?? `Season ${s.number}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          className="season-bar__nav"
          type="button"
          aria-label="Next season"
          disabled={seasonIdx === seasons.length - 1}
          onClick={() =>
            selectSeason(Math.min(seasons.length - 1, seasonIdx + 1))
          }
        >
          <ChevronIcon className="season-bar__nav-icon season-bar__nav-icon--next" />
        </button>

        <input
          className="season-bar__search"
          type="text"
          placeholder="Search Episode"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="episode-grid">
        {episodes.map((ep) => (
          <EpisodeCard
            key={ep.id}
            episode={ep}
            onClick={() => onPick(ep, season.number)}
          />
        ))}
      </div>
      </div>
    </div>
  );
}
