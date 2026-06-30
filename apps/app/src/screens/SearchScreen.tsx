import { useCallback, useEffect, useRef, useState } from "react";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import type { ShareCode, VodItem } from "@blammytv/shared";
import { StreamCard } from "../components/StreamCard";
import { OnScreenKeyboard } from "../components/OnScreenKeyboard";
import { FocusButton } from "../components/FocusButton";
import { SearchIcon } from "../components/icons";
import { searchVodTitles } from "../lib/vod";
import { setFocusFallback } from "../lib/focusGuard";

/** Stream search: an on-screen QWERTY keyboard builds a query that's run — on an
 * explicit Search press, not while typing — against the AIOStreams search
 * catalogs; results show as a poster grid. Remote-only (no system IME). */
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
  // The query the current results are for (null = nothing searched yet).
  const [submitted, setSubmitted] = useState<string | null>(null);
  // Ignore a stale response if a newer search started before it returned.
  const reqId = useRef(0);

  const runSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSubmitted(q);
    const mine = ++reqId.current;
    searchVodTitles(shareCode, q)
      .then((items) => {
        if (mine === reqId.current) setResults(items);
      })
      .catch(() => {
        if (mine === reqId.current) setResults([]);
      })
      .finally(() => {
        if (mine === reqId.current) setLoading(false);
      });
  }, [query, shareCode]);

  // Escape backs out (desktop); on the TV the hardware Back pops the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  // If focus is ever lost on this page (e.g. the results swap under the cursor),
  // the global guard re-homes it to the keyboard.
  useEffect(() => setFocusFallback("search-kbd"), []);

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
        <FocusButton
          className="search-screen__submit"
          focusKey="search-submit"
          onPress={runSearch}
        >
          Search
        </FocusButton>
      </div>
      <ResultsPane
        query={query}
        submitted={submitted}
        loading={loading}
        results={results}
        onOpen={onOpen}
      />
    </div>
  );
}

function ResultsPane({
  query,
  submitted,
  loading,
  results,
  onOpen,
}: {
  query: string;
  submitted: string | null;
  loading: boolean;
  results: VodItem[];
  onOpen: (item: VodItem) => void;
}) {
  if (loading) {
    return <Message>Searching…</Message>;
  }
  if (submitted == null) {
    return (
      <Message>
        {query.trim()
          ? "Press Search to find your titles."
          : "Type a title, then press Search."}
      </Message>
    );
  }
  if (results.length === 0) {
    return <Message>No results for “{submitted}”.</Message>;
  }
  return <ResultsGrid results={results} onOpen={onOpen} />;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="search-results search-results--empty">
      <p>{children}</p>
    </div>
  );
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
