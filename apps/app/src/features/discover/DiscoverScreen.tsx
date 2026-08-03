import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChipTabs } from "../../ui/ChipTabs";
import {
  loadCardMeta,
  onCardMetaChange,
  type CardMetaField,
} from "../settings/cardMeta";
import { Card, RowScroller } from "../stream/StreamScreen";
import {
  onGenreRequest,
  requestOpenInStream,
  takeGenreRequest,
} from "../stream/openRequest";
import type { VodItem } from "../stream/model";
import {
  catKey,
  fetchDiscoverPage,
  genreArtTitle,
  genreArtwork,
  gridCatalogs,
  interleave,
  loadDiscover,
  resolveGenreArt,
  searchDiscover,
  seedFromStream,
  type DiscoverConfig,
} from "./data";
import {
  getSearchQuery,
  onSearchQueryChange,
  setSearchQuery,
} from "./searchQuery";
import { scrubbedMessage } from "../../lib/errors";
import { useMouseNav } from "../../lib/mouseNav";
import { useViewStack } from "../../lib/viewStack";
import { loadAioUrl } from "../settings/aiostreams";
import { readDiscoverSession, saveDiscoverSession } from "./session";

/**
 * Discover: search-free exploration of the addon's catalogs. A pill
 * toggle (All Content / Movies / Series), an art-backed genre rail (the
 * ONLY genre selector — no dropdowns), and an infinite-scroll poster grid
 * of the exact Stream-home Card component. Picking a title hands off to
 * the Stream tab, where detail + playback live.
 */

type TypeFilter = "all" | "movie" | "series";

/** What Discover is showing: the type pill and the selected genre. Search
 * is deliberately NOT in here — it changes per keystroke, and a history
 * entry per character is not a page. */
type DiscoverView = { filter: TypeFilter; genre: string | null };

const FILTER_TABS = [
  { key: "all", label: "All Content" },
  { key: "movie", label: "Movies" },
  { key: "series", label: "Series" },
] as const;

type Cfg =
  | { status: "loading" }
  | { status: "ready"; cfg: DiscoverConfig }
  | { status: "error"; message: string };

export function DiscoverScreen() {
  // Where this tab was when it was last unmounted (a tab flip). Read once,
  // at mount: everything below seeds from it instead of starting over.
  const sessionRef = useRef(readDiscoverSession(loadAioUrl()));
  const session = sessionRef.current;
  const [cfg, setCfg] = useState<Cfg>({ status: "loading" });
  // Picking a genre or a type is a PAGE change here, not just a filter
  // flip: the grid it produces is what you were looking at, so back has to
  // be able to return to it (with the scroll position it had). Both live in
  // the shared view stack for that reason.
  const {
    view,
    scrollRef,
    navigate,
    goBack,
    goForward,
    replace: replaceView,
    restoreTo,
  } = useViewStack<DiscoverView>(() =>
    session
      ? { filter: session.filter, genre: session.genre }
      : { filter: "all", genre: null },
  );
  const { filter, genre } = view;
  const setFilter = useCallback(
    (next: TypeFilter) => navigate({ filter: next, genre }),
    [navigate, genre],
  );
  const setGenre = useCallback(
    (next: string | null) => navigate({ filter, genre: next }),
    [navigate, filter],
  );
  useMouseNav(goBack, goForward);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  useEffect(() => {
    if (cfg.status !== "ready" || !genre) return;
    const match = cfg.cfg.genres.find(
      (x) => x.toLowerCase() === genre.toLowerCase(),
    );
    // Unknown genre → unfiltered browse (an empty "phantom genre" grid
    // would read as broken); casing differences adopt the rail's. Both are
    // corrections to the page you are on, so they replace rather than push:
    // a normalized genre must not become its own history entry.
    if (match === undefined) replaceView((v) => ({ ...v, genre: null }));
    else if (match !== genre) replaceView((v) => ({ ...v, genre: match }));
  }, [cfg, genre, replaceView]);
  const [items, setItems] = useState<VodItem[]>(session?.items ?? []);
  const [phase, setPhase] = useState<"first" | "more" | "idle" | "done">(
    session ? (session.exhausted ? "done" : "idle") : "first",
  );
  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  useEffect(() => onCardMetaChange(setMetaFields), []);
  // "All Content" mixes movies and series in one grid — the card meta
  // always says which is which there, whatever the Card Details setting.
  // The single-type views stay on the user's configured fields.
  // Stable identity: Card is memoized — a fresh array here per render
  // would re-render the whole mounted grid on every keystroke/append.
  const gridMetaFields = useMemo(
    () =>
      filter === "all" && !metaFields.includes("kind")
        ? [...metaFields, "kind" as const]
        : metaFields,
    [filter, metaFields],
  );

  // ---- Search: debounced, across every search-capable catalog of the
  // filtered type. Two+ characters enters search mode (rail + browse
  // grid step aside); clearing or Escape returns to browsing.
  const [query, setQuery] = useState(getSearchQuery);
  useEffect(() => onSearchQueryChange(setQuery), []);
  // Genre hand-off (a detail-screen genre pill): drain on mount and on
  // the event; arriving means BROWSING, so any active search clears —
  // the STORE (for the header's mirror) and the LOCAL state directly.
  // Direct, because the store's clear event can fire before this
  // component's subscription exists (mount-time effect ordering): the
  // fleet caught the hand-off rendering stale search results whenever
  // the chain started from an active search. Normalizes against the
  // rail's casing here when the config is already ready (skips a
  // wasted raw-genre fetch round); the reconcile effect above covers
  // the not-yet-ready mount, unknown genres → unfiltered.
  useEffect(() => {
    const consume = () => {
      const g = takeGenreRequest();
      if (!g) return;
      setSearchQuery("");
      setQuery("");
      const c = cfgRef.current;
      // Arriving from another tab: this IS the page, so it replaces rather
      // than pushing a phantom "no genre" entry behind itself.
      if (c.status === "ready") {
        const match = c.cfg.genres.find(
          (x) => x.toLowerCase() === g.toLowerCase(),
        );
        replaceView((v) => ({ ...v, genre: match ?? null }));
      } else {
        replaceView((v) => ({ ...v, genre: g }));
      }
    };
    consume();
    return onGenreRequest(consume);
  }, [replaceView]);
  const q = query.trim();
  const searching = q.length >= 2;
  // "failed" is distinct from [] — a network failure must not render the
  // definitive "No results" copy (the audit's false-authority finding).
  const [results, setResults] = useState<VodItem[] | "failed" | null>(null);
  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => {
    if (!searching || cfg.status !== "ready") {
      setResults(null);
      return;
    }
    let stale = false;
    setResults(null); // "Searching…" between keystrokes and payload
    const t = window.setTimeout(() => {
      searchDiscover(cfg.cfg, filter, q).then(
        (r) => !stale && setResults(r),
        () => !stale && setResults("failed"),
      );
    }, 350);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [cfg, filter, q, searching, searchTick]);


  // Bumped by the error state's Try-again — re-runs the config load.
  const [cfgTick, setCfgTick] = useState(0);
  useEffect(() => {
    let stale = false;
    loadDiscover().then(
      (c) => !stale && setCfg({ status: "ready", cfg: c }),
      (e) =>
        !stale &&
        setCfg({
          status: "error",
          // Scrubbed: transport errors echo the FULL manifest URL (the
          // credential) and this string renders on screen.
          message: scrubbedMessage(e),
        }),
    );
    return () => {
      stale = true;
    };
  }, [cfgTick]);

  // Rail wallpapers: last visit's art paints instantly, then EVERY genre
  // draws a fresh random title from its own catalog feed and swaps to
  // that title's full-meta backdrop — never sampled from the user's
  // browsed/hero items (Adam: "never pull from my selected sources").
  const [art, setArt] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (cfg.status !== "ready") return;
    let stale = false;
    setArt(genreArtwork(cfg.cfg.genres)); // last visit's art, instantly
    void resolveGenreArt(cfg.cfg, cfg.cfg.genres, (g, src) => {
      if (!stale)
        setArt((prev) =>
          prev.get(g) === src ? prev : new Map(prev).set(g, src),
        );
    });
    return () => {
      stale = true;
    };
  }, [cfg]);

  // ---- The grid feed: per-type skip cursors, interleaved for "all".
  // Everything lives in refs except the rendered list; reqId guards
  // against a stale page landing after a filter/genre switch.
  const [gridFailed, setGridFailed] = useState(false);
  const cursors = useRef<Record<string, number>>({ ...(session?.cursors ?? {}) });
  const doneRef = useRef<Record<string, boolean>>({ ...(session?.done ?? {}) });
  const seenRef = useRef<Set<string>>(new Set(session?.seen ?? []));
  const busyRef = useRef(false);
  const reqIdRef = useRef(0);

  const loadMore = useCallback(
    async (reset: boolean) => {
      if (cfg.status !== "ready") return;
      if (busyRef.current) return;
      busyRef.current = true;
      const reqId = reset ? ++reqIdRef.current : reqIdRef.current;
      if (reset) {
        cursors.current = {};
        doneRef.current = {};
        seenRef.current = new Set();
        // The UNFILTERED grid seeds instantly from the Stream tab's cache
        // (same catalogs, already fetched); each catalog's skip cursor
        // starts past the cached depth so infinite scroll continues on
        // the network from there. Genre grids always fetch (server-side
        // filter — see seedFromStream).
        const seed = genre === null ? seedFromStream(cfg.cfg, filter) : null;
        if (seed) {
          cursors.current = { ...seed.cursors };
          for (const i of seed.items) seenRef.current.add(i.id);
          setItems(seed.items);
          setPhase("idle");
          busyRef.current = false; // early return skips the finally below
          return;
        }
        setItems([]);
        setPhase("first");
      } else {
        setPhase("more");
      }
      try {
        const active = gridCatalogs(cfg.cfg.catalogs, filter, genre).filter(
          (c) => !doneRef.current[catKey(c)],
        );
        if (active.length === 0) {
          if (reqId === reqIdRef.current) setPhase("done");
          return;
        }
        const pages = await Promise.all(
          active.map((c) =>
            fetchDiscoverPage(cfg.cfg, c, genre, cursors.current[catKey(c)] ?? 0)
              .then((page) => ({ c, page: page as VodItem[] | null }))
              // null = transient failure: no cursor advance, NOT done —
              // an empty SUCCESS is the only exhaustion signal, so a
              // network blip can't bench a catalog until the next reset.
              .catch(() => ({ c, page: null })),
          ),
        );
        if (reqId !== reqIdRef.current) return; // filter changed mid-flight
        for (const { c, page } of pages) {
          if (page === null) continue;
          cursors.current[catKey(c)] =
            (cursors.current[catKey(c)] ?? 0) + page.length;
          if (page.length === 0) doneRef.current[catKey(c)] = true;
        }
        const merged = interleave(...pages.map((p) => p.page ?? [])).filter((i) => {
          if (seenRef.current.has(i.id)) return false;
          seenRef.current.add(i.id);
          return true;
        });
        // The genre card's own title leads its grid: what the wallpaper
        // promised is the first thing the click delivers.
        if (reset && genre) {
          const pin = genreArtTitle(genre);
          const at = pin ? merged.findIndex((i) => i.id === pin) : -1;
          if (at > 0) merged.unshift(...merged.splice(at, 1));
        }
        setItems((prev) => (reset ? merged : [...prev, ...merged]));
        // Every page null = nothing was HEARD, not "the catalog is empty" —
        // a reset in that state renders the honest failure note instead of
        // the definitive empty-catalog copy.
        if (reset) setGridFailed(pages.every(({ page }) => page === null));
        const exhausted = pages.every(
          ({ page }) => page !== null && page.length === 0,
        );
        setPhase(exhausted ? "done" : "idle");
      } finally {
        // Only the CURRENT request may unlatch: a superseded flight's
        // finally otherwise opened a concurrent same-generation load
        // (double-advanced cursors = a silently skipped page).
        if (reqId === reqIdRef.current) busyRef.current = false;
      }
    },
    [cfg, filter, genre],
  );

  // Reset + first page on any config/filter/genre change. busyRef can
  // block the reset while a stale page is in flight — bump the reqId
  // FIRST so the stale request self-discards, then retry next tick.
  //
  // A restored session skips exactly one reset: the one the config landing
  // triggers on mount. Without that, the feed we just restored would be
  // thrown away and refetched, which is the whole thing this avoids. It is
  // keyed on the config being ready because the runs before that return
  // immediately and reset nothing.
  const skipReset = useRef(session !== null);
  useEffect(() => {
    if (cfgRef.current.status === "ready" && skipReset.current) {
      skipReset.current = false;
      return;
    }
    reqIdRef.current++;
    busyRef.current = false;
    void loadMore(true);
  }, [loadMore]);

  // Infinite scroll: one sentinel under the grid.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !busyRef.current)
          void loadMore(false);
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // `searching` unmounts/remounts the sentinel with the browse branch —
    // without it in the deps the observer kept watching a detached node
    // and infinite scroll died after any search round-trip.
  }, [loadMore, phase, searching]);

  const open = useCallback((item: VodItem) => requestOpenInStream(item), []);

  // Put the restored position back once the grid it belongs to is on
  // screen. The items rendered on the first commit, so this normally lands
  // immediately; the stack's retry covers art that is still sizing.
  useEffect(() => {
    if (session?.scroll) restoreTo(session.scroll);
    // Mount only: a later run would yank the user back to a stale offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot on the way out (a tab flip unmounts this screen). Everything
  // is read through refs so the cleanup sees the last committed values
  // rather than the ones captured when the effect was set up. The scroll
  // offset is mirrored as it happens rather than read from the element at
  // cleanup time: an unmount cleanup runs in the passive phase, after React
  // has already detached the ref, so scrollRef would be null exactly when
  // it matters.
  const lastScroll = useRef(session?.scroll ?? 0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(
    () => () => {
      saveDiscoverSession({
        key: loadAioUrl(),
        filter: viewRef.current.filter,
        genre: viewRef.current.genre,
        items: itemsRef.current,
        cursors: { ...cursors.current },
        done: { ...doneRef.current },
        seen: [...seenRef.current],
        exhausted: phaseRef.current === "done",
        scroll: lastScroll.current,
      });
    },
    [],
  );

  if (cfg.status === "error") {
    return (
      <div className="discover discover--empty">
        {cfg.message === "no addon configured" ? (
          <>
            <h2>Something new to watch.</h2>
            <p className="discover__note">
              Connect your AIOStreams manifest in Settings → General → Sources and
              this tab fills itself.
            </p>
          </>
        ) : (
          <>
            <h2>Couldn&rsquo;t load Discover.</h2>
            <p className="discover__note" role="alert">
              {cfg.message}
            </p>
            <p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setCfgTick((t) => t + 1)}
              >
                Try again
              </button>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="discover"
      onScroll={(e) => {
        lastScroll.current = e.currentTarget.scrollTop;
      }}
    >
      <div className="discover__toggle">
        <ChipTabs
          tabs={FILTER_TABS}
          active={filter}
          onChange={(k) => setFilter(k)}
        />
      </div>

      {searching ? (
        <section className="discover__gridwrap">
          <h3 className="media-row__title">Results for “{q}”</h3>
          {results === null ? (
            <p className="discover__note" role="status">
              Searching…
            </p>
          ) : results === "failed" ? (
            <p className="discover__note" role="alert">
              Search didn&rsquo;t go through.{" "}
              <button
                type="button"
                className="btn-primary"
                onClick={() => setSearchTick((t) => t + 1)}
              >
                Try again
              </button>
            </p>
          ) : results.length === 0 ? (
            <p className="discover__note">No results for “{q}”.</p>
          ) : (
            <div className="disc-grid">
              {results.map((item) => (
                <Card
                  key={item.id}
                  item={item}
                  metaFields={gridMetaFields}
                  onOpen={open}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
      {cfg.status === "ready" && cfg.cfg.genres.length > 0 && (
        <section className="media-row discover__genres">
          <h3 className="media-row__title">By Genre</h3>
          <RowScroller>
            {cfg.cfg.genres.map((g) => {
              const bg = art.get(g);
              const on = genre === g;
              return (
                <button
                  key={g}
                  type="button"
                  className={"genre-card" + (on ? " genre-card--on" : "")}
                  aria-pressed={on}
                  onClick={() => setGenre(on ? null : g)}
                >
                  {bg && (
                    <img
                      className="genre-card__art"
                      src={bg}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      // Dead art URL → the flat card, not a broken-image box.
                      onError={() =>
                        setArt((prev) => {
                          if (prev.get(g) !== bg) return prev;
                          const next = new Map(prev);
                          next.delete(g);
                          return next;
                        })
                      }
                    />
                  )}
                  {bg && <span className="genre-card__scrim" aria-hidden />}
                  <span className="genre-card__name">{g}</span>
                </button>
              );
            })}
          </RowScroller>
        </section>
      )}

      <section className="discover__gridwrap">
        <h3 className="media-row__title">
          {genre ?? (filter === "movie" ? "Movies" : filter === "series" ? "Series" : "Popular")}
        </h3>
        {phase === "first" ? (
          <>
            <p className="vh" role="status">
              Loading the catalog…
            </p>
            <div className="disc-grid" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="disc-skel" />
            ))}
            </div>
          </>
        ) : items.length === 0 && gridFailed ? (
          <p className="discover__note" role="alert">
            Discover didn&rsquo;t load. The catalog never answered.{" "}
            <button
              type="button"
              className="btn-primary"
              onClick={() => void loadMore(true)}
            >
              Try again
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="discover__note">
            Nothing here. The catalog returned no titles
            {genre ? ` for ${genre}` : ""}.
          </p>
        ) : (
          <div className="disc-grid">
            {items.map((item) => (
              <Card
                key={item.id}
                item={item}
                metaFields={gridMetaFields}
                onOpen={open}
              />
            ))}
          </div>
        )}
        {phase === "more" && (
          <p className="discover__note" role="status">
            Loading more…
          </p>
        )}
        <div ref={sentinelRef} className="discover__sentinel" aria-hidden />
      </section>
        </>
      )}
    </div>
  );
}
