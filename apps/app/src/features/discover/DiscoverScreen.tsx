import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logGridPage, logGridReset, logGridShown } from "./genreLog";
import { Button } from "../../components/ui/button";
import { DiscoverIcon, SearchIcon, WarnIcon } from "../../ui/icons";
import { StateCard } from "../../ui/StateCard";
import { BackButton } from "../../ui/BackButton";
import {
  loadCardMeta,
  onCardMetaChange,
  type CardMetaField,
} from "../settings/cardMeta";
import { Card } from "../../ui/Card";
import { RowScroller } from "../../ui/RowScroller";
import {
  onTypeFilterRequest,
  publishTypeFilter,
  resetTypeFilter,
  takeTypeFilterRequest,
} from "./typeFilter";
import {
  onGenreRequest,
  requestOpenInStream,
  takeGenreRequest,
} from "../stream/openRequest";
import type { VodItem } from "../stream/model";
import {
  catKey,
  discoverKey,
  fetchDiscoverPage,
  genreArtTitle,
  genreArtwork,
  gridCatalogs,
  interleave,
  itemKey,
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
import { Recommender } from "./Recommender";
import {
  TMDB_WAIT_MS,
  POOL_PAGES,
  POOL_TARGET,
  ROW_MAX,
  buildRows,
  dropOffGenre,
  noteAppearances,
  orderMeaningful,
  pinFirst,
  rankCards,
  type Appearances,
  type GenreRow,
} from "./genreRows";
import { popularInGenre } from "./genreTmdb";
import {
  onRecommendRequest,
  publishRecommend,
  resetRecommend,
  takeRecommendRequest,
} from "./recommend";
import { JF_CHANGED } from "../jellyfin/store";
import { AIO_CONN_CHANGED } from "../settings/aiostreams";
import { onPlaylistsChange } from "../settings/playlists";
import { XT_CHANGED } from "../xtvod/store";
import { XT_LOADED, xtDiscoverKey } from "../xtvod/vod";
import { readDiscoverSession, saveDiscoverSession } from "./session";

/**
 * Discover: search-free exploration of the addon's catalogs. A pill
 * toggle (All Content / Movies / Series), an art-backed genre rail (the
 * ONLY genre selector — no dropdowns), and an infinite-scroll poster grid
 * of the exact Stream-home Card component. Picking a title hands off to
 * the Stream tab, where detail + playback live.
 */

import type { TypeFilter } from "./typeFilter";

/** What Discover is showing: the type pill and the selected genre. Search
 * is deliberately NOT in here — it changes per keystroke, and a history
 * entry per character is not a page. */
type DiscoverView = {
  filter: TypeFilter;
  genre: string | null;
  /* The recommender is a PAGE, so it lives in the view stack like the
   * genre and the type do. Back and the mouse's back button then leave it
   * for free, with the grid underneath restored to where it was. */
  rec?: true;
  /* A genre's "See All" page (plan 034): a row's id, or "all" for the whole
   * genre. A page like the recommender, so Back and the mouse's back button
   * return to the rows at the scroll position they were left at. */
  see?: string;
};

type Cfg =
  | { status: "loading" }
  | { status: "ready"; cfg: DiscoverConfig }
  | { status: "error"; message: string };

export function DiscoverScreen({ home }: { home?: number } = {}) {
  // Where this tab was when it was last unmounted (a tab flip). Read once,
  // at mount: everything below seeds from it instead of starting over.
  const sessionRef = useRef(readDiscoverSession(discoverKey()));
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
    goHome,
  } = useViewStack<DiscoverView>(() =>
    session
      ? { filter: session.filter, genre: session.genre }
      : { filter: "all", genre: null },
  );
  const { filter, genre } = view;
  /* The header's chips send a request; turning it into navigate() is what
   * puts the choice in this screen's history. Collected on mount too: the
   * header can fire while this screen is unmounted, and App holds the
   * swap back by NAV_SETTLE_MS on top of that. */
  useEffect(() => {
    const honour = () => {
      const want = takeTypeFilterRequest();
      if (!want) return;
      // `|| rec` and not just a filter change: the chips share row 2's thumb
      // with REC now, so pressing the filter you are already on while the
      // recommender is open is a real press — it means "back to the grid" —
      // and dropping it left the chip you clicked dead under a thumb parked
      // somewhere else.
      if (want !== viewRef.current.filter || viewRef.current.rec)
        navigate({ filter: want, genre: viewRef.current.genre });
    };
    honour();
    return onTypeFilterRequest(honour);
  }, [navigate]);
  /* The REC chip, drained the same way and for the same reason: the header
   * can press it while this screen is unmounted, and App holds the swap
   * back by NAV_SETTLE_MS on top of that. Navigating rather than setting
   * state is what puts the page in history, so Back leaves it. */
  useEffect(() => {
    const honour = () => {
      if (!takeRecommendRequest()) return;
      if (viewRef.current.rec) return; // already there; do not stack it
      navigate({ ...viewRef.current, rec: true });
    };
    honour();
    return onRecommendRequest(honour);
  }, [navigate]);
  useEffect(() => () => resetRecommend(), []);
  /* And the other direction, so the header's thumb can sit on the chip:
   * whatever the committed view is, say so, Back and Forward included. */
  useEffect(() => publishRecommend(!!view.rec), [view.rec]);
  /* And the other direction: whatever the committed view is, say so —
   * including when Back or Forward is what changed it. */
  useEffect(() => publishTypeFilter(filter), [filter]);
  /* A tab flip unmounts this screen; the next mount seeds from its own
   * session, so the header must not keep claiming the old filter. */
  useEffect(() => () => resetTypeFilter("all"), []);

  const setGenre = useCallback(
    (next: string | null) => navigate({ filter, genre: next }),
    [navigate, filter],
  );
  useMouseNav(goBack, goForward);
  // The Discover pill, pressed while it is showing, takes it home (App counts
  // the press): everything, no genre, no recommender, scrolled to the top.
  // The header has already dropped a search with the same press. Not the
  // stack's first entry, which is wherever this tab was left last.
  const pressed = useRef(home);
  useEffect(() => {
    if (pressed.current === home) return;
    pressed.current = home;
    goHome({ filter: "all", genre: null });
  }, [home, goHome]);
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
  // The genre page's rows (plan 034), built once when the pool lands. Null is
  // no rows: the unfiltered grid, or a genre whose cards say too little about
  // themselves to cut into rows, which is the ranked grid instead.
  const [rows, setRows] = useState<GenreRow[] | null>(session?.rows ?? null);
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
  // A sign-in to Jellyfin or to AIOStreams that lands, or ends (a 401), or a
  // manifest saved or cleared, while this tab is up (Settings opens over it).
  // And an Xtream library: its switch, a playlist added, switched off or taken
  // out, or its lists landing. Only when the feeds would be other than they are
  // (`xtKey`): a pick, or the same lists read again, changes nothing here, and a
  // reload would empty the grid.
  useEffect(() => {
    const again = () => setCfgTick((t) => t + 1);
    const xtAgain = () => {
      const now = cfgRef.current;
      if (now.status === "ready" && now.cfg.xtKey === xtDiscoverKey()) return;
      again();
    };
    window.addEventListener(JF_CHANGED, again);
    window.addEventListener(AIO_CONN_CHANGED, again);
    window.addEventListener(XT_CHANGED, xtAgain);
    window.addEventListener(XT_LOADED, xtAgain);
    const offPlaylists = onPlaylistsChange(xtAgain);
    return () => {
      window.removeEventListener(JF_CHANGED, again);
      window.removeEventListener(AIO_CONN_CHANGED, again);
      window.removeEventListener(XT_CHANGED, xtAgain);
      window.removeEventListener(XT_LOADED, xtAgain);
      offPlaylists();
    };
  }, []);
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
  // Where each card of a genre was seen, which ranks the rows and every batch
  // the grid loads after them.
  const appearRef = useRef<Appearances>(new Map(session?.appear ?? []));
  const busyRef = useRef(false);
  const reqIdRef = useRef(0);

  const loadMore = useCallback(
    async (reset: boolean) => {
      if (cfg.status !== "ready") return;
      if (busyRef.current) return;
      busyRef.current = true;
      const reqId = reset ? ++reqIdRef.current : reqIdRef.current;
      if (reset) {
        logGridReset(genre);
        cursors.current = {};
        doneRef.current = {};
        seenRef.current = new Set();
        appearRef.current = new Map();
        setRows(null);
        // The UNFILTERED grid seeds instantly from the Stream tab's cache
        // (same catalogs, already fetched); each catalog's skip cursor
        // starts past the cached depth so infinite scroll continues on
        // the network from there. Genre grids always fetch (server-side
        // filter — see seedFromStream).
        const seed = genre === null ? seedFromStream(cfg.cfg, filter) : null;
        if (seed) {
          cursors.current = { ...seed.cursors };
          for (const i of seed.items) seenRef.current.add(itemKey(i));
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
        // One page from every catalog still open. Moves the cursors, logs
        // the page, notes where each card sat (a genre's ranking reads it),
        // and returns the cards not seen before, interleaved. `pages` is
        // empty when every catalog is done; the whole result is null when a
        // newer request took over while this one was out.
        const round = async () => {
          const active = gridCatalogs(cfg.cfg.catalogs, filter, genre).filter(
            (c) => !doneRef.current[catKey(c)],
          );
          if (active.length === 0) return { pages: [], fresh: [] as VodItem[] };
          const pages = await Promise.all(
            active.map((c) =>
              fetchDiscoverPage(cfg.cfg, c, genre, cursors.current[catKey(c)] ?? 0)
                .then((page) => ({ c, page: page as VodItem[] | null }))
                // null = transient failure: no cursor advance, NOT done.
                // An empty SUCCESS is the only exhaustion signal, so a
                // network blip can't bench a catalog until the next reset.
                .catch(() => ({ c, page: null })),
            ),
          );
          if (reqId !== reqIdRef.current) return null; // filter changed mid-flight
          for (const { c, page } of pages) {
            if (page === null) continue;
            const at = cursors.current[catKey(c)] ?? 0;
            logGridPage(c, at, page);
            if (genre) noteAppearances(appearRef.current, catKey(c), at, page);
            cursors.current[catKey(c)] = at + page.length;
            if (page.length === 0) doneRef.current[catKey(c)] = true;
          }
          const fresh = interleave(...pages.map((p) => p.page ?? [])).filter((i) => {
            if (seenRef.current.has(itemKey(i))) return false;
            seenRef.current.add(itemKey(i));
            return true;
          });
          return { pages, fresh };
        };
        const spent = (pages: { page: VodItem[] | null }[]) =>
          pages.every(({ page }) => page !== null && page.length === 0);

        if (reset && genre) {
          // A genre opens as rows (plan 034): the first pages of every
          // catalog that serves it, until there are about POOL_TARGET cards,
          // POOL_PAGES deep at most. TMDB's popular titles are asked for at
          // the same time, and waited for only so long.
          const tmdb = Promise.race([
            popularInGenre(genre, filter).catch(() => [] as VodItem[]),
            new Promise<VodItem[]>((r) => window.setTimeout(() => r([]), TMDB_WAIT_MS)),
          ]);
          const pool: VodItem[] = [];
          let heard = false;
          let finished = false;
          for (let n = 0; n < POOL_PAGES && pool.length < POOL_TARGET && !finished; n++) {
            const got = await round();
            if (got === null) return;
            finished = got.pages.length === 0 || spent(got.pages);
            // No catalog serving the genre has nothing to hear, which is not
            // a failure either.
            heard ||= got.pages.length === 0 || got.pages.some(({ page }) => page !== null);
            pool.push(...got.fresh);
          }
          const popular = await tmdb;
          if (reqId !== reqIdRef.current) return;
          // Off-genre cards are gone from everything; cards that say nothing
          // about their genres stay for See All and never reach a row. When
          // there are no rows to make (too few cards say anything), the page
          // is today's grid, ranked.
          const pin = genreArtTitle(genre);
          const order = { genre, ordered: orderMeaningful(pool) };
          const shown = pinFirst(rankCards(dropOffGenre(pool, genre), appearRef.current, order), pin);
          const made = buildRows(pool, genre, filter, appearRef.current, { tmdb: popular, pin });
          logGridShown(shown);
          setItems(shown);
          setRows(made.length > 0 ? made : null);
          setGridFailed(!heard);
          setPhase(finished ? "done" : "idle");
          return;
        }

        const got = await round();
        if (got === null) return;
        if (got.pages.length === 0) {
          setPhase("done");
          return;
        }
        // A genre's later batches rank on their own and are appended, so a
        // card already on screen never moves.
        const merged = genre
          ? rankCards(dropOffGenre(got.fresh, genre), appearRef.current, {
              genre,
              ordered: orderMeaningful(got.fresh),
            })
          : got.fresh;
        logGridShown(merged);
        setItems((prev) => (reset ? merged : [...prev, ...merged]));
        // Every page null = nothing was HEARD, not "the catalog is empty" —
        // a reset in that state renders the honest failure note instead of
        // the definitive empty-catalog copy.
        if (reset) setGridFailed(got.pages.every(({ page }) => page === null));
        setPhase(spent(got.pages) ? "done" : "idle");
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

  // What a genre shows (plan 034): its rows, or one grid. The grid is a
  // See All page (the whole genre, or one row's cards), or the whole page when
  // there are no rows to show.
  const seeing =
    genre && view.see === "all"
      ? "all"
      : genre && rows
        ? (rows.find((r) => r.id === view.see) ?? null)
        : null;
  const rowsMode = !!genre && !!rows && !seeing;
  const seeAll = useCallback(
    (see: string) => navigate({ filter, genre, see }),
    [navigate, filter, genre],
  );

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
    // And with the rows: they have no sentinel, a See All page does.
  }, [loadMore, phase, searching, rowsMode, seeing]);

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
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(
    () => () => {
      saveDiscoverSession({
        key: discoverKey(),
        filter: viewRef.current.filter,
        genre: viewRef.current.genre,
        items: itemsRef.current,
        cursors: { ...cursors.current },
        done: { ...doneRef.current },
        seen: [...seenRef.current],
        exhausted: phaseRef.current === "done",
        // A See All page is not restored (the rows are), so neither is its offset.
        scroll: viewRef.current.see ? 0 : lastScroll.current,
        rows: rowsRef.current,
        appear: new Map(appearRef.current),
      });
    },
    [],
  );

  /* The recommender takes the whole tab. Rendered BEFORE the grid's return
   * rather than inside it: it has its own full-height layout and must not
   * inherit the scroll container.
   *
   * AND BEFORE THE ERROR STATE BELOW, which is about the GRID and not about
   * this. The recommender never reads the catalog config: its artwork is a
   * prop and its answers come from TMDB, resolved by IMDb id. So a config
   * that failed to load is not a reason to withhold it — and withholding it
   * left the header's REC chip lit, with its label open under the thumb,
   * over a page that was not on screen. */
  if (view.rec)
    return (
      <Recommender
        // "Any" means films here. TMDB's keyword discovery is per type, and
        // a picker that answers a mood with a TV series when you asked for
        // something to watch tonight is the less useful default.
        kind={filter === "series" ? "series" : "movie"}
        posters={items.map((i) => i.poster ?? "").filter(Boolean).slice(0, 12)}
        onOpen={open}
      />
    );

  // A row's See All is that row's cards; the rest of the grids are the feed.
  const shown = seeing && seeing !== "all" ? seeing.all : items;

  if (cfg.status === "error") {
    return (
      <div className="discover discover--empty">
        {/* The tab's states are the StateCard (plan 019, K8). */}
        {cfg.message === "no addon configured" ? (
          <StateCard
            icon={<DiscoverIcon size={28} />}
            title="Nothing to Discover Yet"
            sub="Sign in to AIOStreams or Jellyfin, or add an Xtream playlist with movies and shows, in Settings → Sources."
          />
        ) : (
          <StateCard
            role="alert"
            icon={<WarnIcon size={28} />}
            title="Couldn’t Load Discover"
            sub={cfg.message}
            actions={
              <Button
                variant="default"
                type="button"
                onClick={() => setCfgTick((t) => t + 1)}
              >
                Try Again
              </Button>
            }
          />
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
      {searching ? (
        <section className="discover__gridwrap">
          <h3 className="media-row__title">Results for “{q}”</h3>
          {results === null ? (
            <StateCard role="status" busy title="Searching…" />
          ) : results === "failed" ? (
            <StateCard
              role="alert"
              icon={<WarnIcon size={28} />}
              title="Search didn’t go through."
              actions={
                <Button
                  variant="default"
                  type="button"
                  onClick={() => setSearchTick((t) => t + 1)}
                >
                  Try Again
                </Button>
              }
            />
          ) : results.length === 0 ? (
            <StateCard
              icon={<SearchIcon size={28} />}
              title={<>No Results for “{q}”</>}
            />
          ) : (
            <div className="disc-grid">
              {results.map((item) => (
                <Card
                  key={itemKey(item)}
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

      {rowsMode && rows ? (
        <>
          {/* A genre's rows (plan 034): Stream's own row markup, so the
            * posters are its 240 and the details wait for a hover. */}
          <div className="stream__rows genre-rows">
            {rows.map((row) => (
              <section className="media-row" key={row.id}>
                <div className="genre-rows__head">
                  <h3 className="media-row__title">{row.title}</h3>
                  {row.from && (
                    <span className="genre-rows__chip">From {row.from}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="genre-rows__all"
                    aria-label={`See All ${row.title}`}
                    onClick={() => seeAll(row.id)}
                  >
                    See All
                  </Button>
                </div>
                <RowScroller>
                  {row.all.slice(0, ROW_MAX).map((item) => (
                    <Card
                      key={itemKey(item)}
                      item={item}
                      metaFields={gridMetaFields}
                      onOpen={open}
                    />
                  ))}
                </RowScroller>
              </section>
            ))}
          </div>
          {items.length > 0 && (
            <div className="genre-rows__foot">
              <Button variant="secondary" type="button" onClick={() => seeAll("all")}>
                See All {genre}
              </Button>
            </div>
          )}
        </>
      ) : (
      <section className="discover__gridwrap">
        {seeing ? (
          <div className="library__bar">
            <BackButton className="vod-back" onClick={goBack} />
            <h2 className="library__heading">
              {seeing === "all" ? `All ${genre}` : seeing.title}
            </h2>
          </div>
        ) : genre && phase === "first" ? null : (
          <h3 className="media-row__title">
            {genre ?? (filter === "movie" ? "Movies" : filter === "series" ? "Series" : "Popular")}
          </h3>
        )}
        {phase === "first" ? (
          <>
            <p className="vh" role="status">
              Loading the catalog…
            </p>
            {genre ? (
              <div className="stream__rows genre-rows" aria-hidden>
                {[0, 1].map((r) => (
                  <section className="media-row" key={r}>
                    <div className="disc-skel genre-rows__skel-title" />
                    <div className="genre-rows__skel">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="disc-skel" />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="disc-grid" aria-hidden>
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="disc-skel" />
                ))}
              </div>
            )}
          </>
        ) : shown.length === 0 && gridFailed ? (
          <StateCard
            role="alert"
            icon={<WarnIcon size={28} />}
            title="Discover didn’t load."
            sub="The catalog never answered."
            actions={
              <Button
                variant="default"
                type="button"
                onClick={() => void loadMore(true)}
              >
                Try Again
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <StateCard
            icon={<DiscoverIcon size={28} />}
            title="No Titles"
          />
        ) : (
          <div className="disc-grid">
            {shown.map((item) => (
              <Card
                key={itemKey(item)}
                item={item}
                metaFields={gridMetaFields}
                onOpen={open}
              />
            ))}
          </div>
        )}
        {phase === "more" && (
          <p className="discover__note" role="status">
            Loading More…
          </p>
        )}
        {/* A row's See All is that row and no more: no sentinel, or it would
          * page the whole genre in behind it. */}
        {shown === items && (
          <div ref={sentinelRef} className="discover__sentinel" aria-hidden />
        )}
      </section>
      )}
        </>
      )}
    </div>
  );
}
