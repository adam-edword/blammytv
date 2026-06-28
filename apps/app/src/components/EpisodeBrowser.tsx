import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  FocusContext,
  setFocus,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import type { VodItem, Episode } from "@blammytv/shared";
import { EpisodeCard } from "./EpisodeCard";
import { FocusButton } from "./FocusButton";
import { ChevronIcon } from "./icons";
import { gradientFor } from "../lib/vod";

const BACK_KEY = "series-back";
const SELECT_KEY = "season-select";
const episodeKey = (id: string) => `ep-${id}`;
const seasonOptKey = (i: number) => `season-opt-${i}`;

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

  // The episode grid is a 2D focus group (▲▼◀▶ between episodes).
  const { ref: gridRef, focusKey: gridFocusKey } = useFocusable<HTMLDivElement>({
    saveLastFocusedChild: true,
    trackChildren: true,
  });
  // The season dropdown is its own (vertical) focus group while it's open.
  const { ref: menuRef, focusKey: menuFocusKey } =
    useFocusable<HTMLUListElement>({ saveLastFocusedChild: false });

  // Land focus on the first episode when the browser opens.
  useEffect(() => {
    const first = seasons[0]?.episodes[0];
    if (!first) return;
    const id = requestAnimationFrame(() => setFocus(episodeKey(first.id)));
    return () => cancelAnimationFrame(id);
    // Mount only: subsequent season changes manage their own focus below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the dropdown is open: focus the current season, and let Back/Escape
  // close it (returning focus to the select button) rather than leaving the page.
  useEffect(() => {
    if (!menuOpen) return;
    const raf = requestAnimationFrame(() => setFocus(seasonOptKey(seasonIdx)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        setMenuOpen(false);
        setFocus(SELECT_KEY);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, seasonIdx]);

  // Season prev/next: keep focus on the control (the grid swaps underneath).
  const changeSeason = (i: number) => {
    setSeasonIdx(i);
    setQuery("");
  };
  // Dropdown pick: close the menu and drop into the new season's episodes.
  const pickSeasonFromMenu = (i: number) => {
    setSeasonIdx(i);
    setMenuOpen(false);
    setQuery("");
    const first = seasons[i]?.episodes[0];
    if (first) requestAnimationFrame(() => setFocus(episodeKey(first.id)));
  };

  const meta = [
    item.year,
    item.kind === "series" ? "Series" : "Movie",
    item.rating != null ? `★ ${item.rating.toFixed(1)}/10` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const backdrop = item.backdrop ?? item.poster;
  const backdropStyle: CSSProperties = backdrop
    ? { backgroundImage: `url(${backdrop})` }
    : { background: gradientFor(item.id) };

  return (
    <div className="detail">
      <div className="detail__backdrop" style={backdropStyle} />
      <div className="detail__scrim detail__scrim--series" />
      <div className="series">
        <FocusButton
          className="detail__back"
          focusKey={BACK_KEY}
          onPress={onBack}
        >
          <ChevronIcon className="detail__back-icon" />
          Back
        </FocusButton>

        <header className="series__header">
          <div className="series__title-block">
            {item.logo ? (
              <img
                className="detail__logo series__logo"
                src={item.logo}
                alt={item.title}
              />
            ) : (
              <h1 className="detail__title series__title">{item.title}</h1>
            )}
            {item.synopsis && <p className="detail__synopsis">{item.synopsis}</p>}
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
          <FocusButton
            className="season-bar__nav"
            focusKey="season-prev"
            ariaLabel="Previous season"
            disabled={seasonIdx === 0}
            onPress={() => changeSeason(Math.max(0, seasonIdx - 1))}
          >
            <ChevronIcon className="season-bar__nav-icon season-bar__nav-icon--prev" />
          </FocusButton>

          <div className="season-bar__select-wrap">
            <FocusButton
              className="season-bar__select"
              focusKey={SELECT_KEY}
              onPress={() => setMenuOpen((o) => !o)}
            >
              {season.name ?? `Season ${season.number}`}
              <ChevronIcon className="season-bar__caret" />
            </FocusButton>
            {menuOpen && (
              <FocusContext.Provider value={menuFocusKey}>
                <ul className="season-bar__menu" role="listbox" ref={menuRef}>
                  {seasons.map((s, i) => (
                    <li key={s.id}>
                      <FocusButton
                        focusKey={seasonOptKey(i)}
                        className={
                          "season-bar__option" +
                          (i === seasonIdx ? " season-bar__option--active" : "")
                        }
                        onPress={() => pickSeasonFromMenu(i)}
                      >
                        {s.name ?? `Season ${s.number}`}
                      </FocusButton>
                    </li>
                  ))}
                </ul>
              </FocusContext.Provider>
            )}
          </div>

          <FocusButton
            className="season-bar__nav season-bar__nav--next"
            focusKey="season-next"
            ariaLabel="Next season"
            disabled={seasonIdx === seasons.length - 1}
            onPress={() =>
              changeSeason(Math.min(seasons.length - 1, seasonIdx + 1))
            }
          >
            <ChevronIcon className="season-bar__nav-icon season-bar__nav-icon--next" />
          </FocusButton>

          <input
            className="season-bar__search"
            type="text"
            placeholder="Search Episode"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <FocusContext.Provider value={gridFocusKey}>
          <div className="episode-grid" ref={gridRef}>
            {episodes.map((ep) => (
              <EpisodeCard
                key={ep.id}
                episode={ep}
                focusKey={episodeKey(ep.id)}
                onClick={() => onPick(ep, season.number)}
              />
            ))}
          </div>
        </FocusContext.Provider>
      </div>
    </div>
  );
}
