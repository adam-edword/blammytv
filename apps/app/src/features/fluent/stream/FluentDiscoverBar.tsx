import { useEffect, useRef, useState } from "react";
import { SearchIcon, SparkleIcon } from "../../../ui/icons";
import { Segmented } from "../../../ui/Segmented";
import { requestRecommend } from "../../discover/recommend";
import { onSearchFocusRequest, setSearchQuery, takeSearchFocus } from "../../discover/searchQuery";
import { tmdbEnabled } from "../../discover/tmdb";
import { requestTypeFilter, type TypeFilter } from "../../discover/typeFilter";
import { FlCombo, FlPageTitle } from "./controls";

/** What the field says it searches, as the header's did: searchDiscover drops
 * every catalog of the other type, so with Movies picked no series comes back. */
const SCOPE: Record<TypeFilter, string> = { all: "Movies & Series", movie: "Movies", series: "Series" };

const TYPES: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "movie", label: "Movies" },
  { key: "series", label: "Series" },
];

/**
 * Discover's title and command row in Fluent (plan 035, "Fluent to tier 3"):
 * a SelectorBar for the type, a Genre ComboBox, the page's own search box and
 * "Find Something to Watch". Fluent's chrome has no sub-nav, so these live in
 * the page, and they drive what the header's second row drove: the type is a
 * REQUEST (DiscoverScreen turns it into a page in its history), the query is
 * the shared search store, REC is the recommender's request, and the genre is
 * the screen's own setter.
 */
export function FluentDiscoverBar({
  filter,
  genre,
  genres,
  onGenre,
  query,
}: {
  filter: TypeFilter;
  genre: string | null;
  genres: string[];
  onGenre: (g: string | null) => void;
  query: string;
}) {
  // REC needs a TMDB key, read once as the header read it.
  const [rec] = useState(tmdbEnabled);
  const field = useRef<HTMLInputElement>(null);
  // `/` and Ctrl+F ask for the field through the mailbox in searchQuery.
  useEffect(() => {
    const focus = () => {
      if (takeSearchFocus()) field.current?.focus();
    };
    focus();
    return onSearchFocusRequest(focus);
  }, []);
  return (
    <>
      <FlPageTitle>Discover</FlPageTitle>
      <div className="fls-cmd" role="group" aria-label="Discover">
        <Segmented
          className="fls-selector"
          label="Type"
          options={TYPES}
          value={filter}
          onChange={(k) => requestTypeFilter(k)}
        />
        <FlCombo
          label="Genre"
          value={genre ?? ""}
          options={[{ value: "", label: "Any" }, ...genres.map((g) => ({ value: g, label: g }))]}
          onChange={(v) => onGenre(v || null)}
        />
        <span className="fls-cmd__gap" />
        <span className="fls-search">
          <input
            ref={field}
            type="search"
            placeholder={`Search ${SCOPE[filter]}`}
            aria-label={`Search ${SCOPE[filter]}`}
            value={query}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setSearchQuery("");
                e.currentTarget.blur();
              }
            }}
          />
          <SearchIcon size={14} aria-hidden />
        </span>
        {rec && (
          <button type="button" className="fls-btn" onClick={() => requestRecommend()}>
            <SparkleIcon size={14} /> Find Something to Watch
          </button>
        )}
      </div>
    </>
  );
}
