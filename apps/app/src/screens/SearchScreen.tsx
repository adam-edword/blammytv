import { useEffect, useRef, useState } from "react";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import type { ShareCode, VodItem } from "@blammytv/shared";
import { StreamCard } from "../components/StreamCard";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { SearchIcon } from "../components/icons";
import { searchVodTitles } from "../lib/vod";

const DEBOUNCE_MS = 400;

/** Stream search: an on-screen keyboard drives a query that's run against the
 * AIOStreams search catalogs; results show as a poster grid. Remote-only — the
 * keyboard is D-pad navigable (no system IME). */
export function SearchScreen({
  shareCode,
  onOpen,
  onBack,
}: {
  shareCode: ShareCode;
  onOpen: (item: VodItem) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // Ignore responses from superseded queries (newer query already in flight).
  const reqId = useRef(0);

  // Debounced search whenever the query settles.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const mine = ++reqId.current;
      searchVodTitles(shareCode, q)
        .then((items) => {
          if (mine !== reqId.current) return;
          setResults(items);
          setSearched(true);
        })
        .catch(() => {
          if (mine !== reqId.current) return;
          setResults([]);
          setSearched(true);
        })
        .finally(() => {
          if (mine === reqId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, shareCode]);

  // Escape backs out (desktop); on the TV the hardware Back pops the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="search-screen">
      <div className="search-screen__left">
        <div className="search-screen__bar">
          <SearchIcon />
          {query ? (
            <span className="search-screen__query">
              {query}
              <span className="search-screen__caret" aria-hidden="true" />
            </span>
          ) : (
            <span className="search-screen__placeholder">
              Search movies &amp; shows
            </span>
          )}
        </div>
        <OnScreenKeyboard
          focusKey="search-kbd"
          onChar={(ch) => setQuery((q) => q + ch)}
          onBackspace={() => setQuery((q) => q.slice(0, -1))}
          onClear={() => setQuery("")}
        />
      </div>
      <ResultsPane
        query={query}
        loading={loading}
        searched={searched}
        results={results}
        onOpen={onOpen}
      />
    </div>
  );
}

function ResultsPane({
  query,
  loading,
  searched,
  results,
  onOpen,
}: {
  query: string;
  loading: boolean;
  searched: boolean;
  results: VodItem[];
  onOpen: (item: VodItem) => void;
}) {
  // An empty/loading state has no cards to focus, so keep the grid a plain div;
  // wrap only the populated grid in a focus context.
  if (!query.trim()) {
    return (
      <div className="search-results search-results--empty">
        <p>Type to search your catalog.</p>
      </div>
    );
  }
  if (loading && results.length === 0) {
    return (
      <div className="search-results search-results--empty">
        <p>Searching…</p>
      </div>
    );
  }
  if (searched && results.length === 0) {
    return (
      <div className="search-results search-results--empty">
        <p>No results for “{query.trim()}”.</p>
      </div>
    );
  }
  return <ResultsGrid results={results} onOpen={onOpen} />;
}

function ResultsGrid({
  results,
  onOpen,
}: {
  results: VodItem[];
  onOpen: (item: VodItem) => void;
}) {
  const { ref, focusKey } = useFocusable<HTMLDivElement>({
    saveLastFocusedChild: true,
    trackChildren: true,
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="search-results search-results__grid">
        {results.map((item) => (
          <StreamCard
            key={item.id}
            item={item}
            layout="poster"
            rowId="search"
            onOpen={onOpen}
          />
        ))}
      </div>
    </FocusContext.Provider>
  );
}
