import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChipTabs } from "../../ui/ChipTabs";
import {
  loadCardMeta,
  onCardMetaChange,
  type CardMetaField,
} from "../settings/cardMeta";
import { Card, RowScroller } from "../stream/StreamScreen";
import { requestOpenInStream } from "../stream/openRequest";
import type { VodItem } from "../stream/model";
import {
  fetchDiscoverPage,
  genreArtwork,
  interleave,
  loadDiscover,
  servesGenre,
  type DiscoverConfig,
} from "./data";

/**
 * Discover: search-free exploration of the addon's catalogs. A pill
 * toggle (All Content / Movies / Series), an art-backed genre rail (the
 * ONLY genre selector — no dropdowns), and an infinite-scroll poster grid
 * of the exact Stream-home Card component. Picking a title hands off to
 * the Stream tab, where detail + playback live.
 */

type TypeFilter = "all" | "movie" | "series";

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
  const [cfg, setCfg] = useState<Cfg>({ status: "loading" });
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [genre, setGenre] = useState<string | null>(null);
  const [items, setItems] = useState<VodItem[]>([]);
  const [phase, setPhase] = useState<"first" | "more" | "idle" | "done">(
    "first",
  );
  const [metaFields, setMetaFields] = useState<CardMetaField[]>(loadCardMeta);
  useEffect(() => onCardMetaChange(setMetaFields), []);

  useEffect(() => {
    let stale = false;
    loadDiscover().then(
      (c) => !stale && setCfg({ status: "ready", cfg: c }),
      (e) =>
        !stale &&
        setCfg({
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
    );
    return () => {
      stale = true;
    };
  }, []);

  // Rail wallpapers: dealt once per visit (deliberately random — fresh
  // art each time the tab opens), from the Stream tab's cached catalog.
  const art = useMemo(
    () => (cfg.status === "ready" ? genreArtwork(cfg.cfg.genres) : new Map()),
    [cfg],
  );

  // ---- The grid feed: per-type skip cursors, interleaved for "all".
  // Everything lives in refs except the rendered list; reqId guards
  // against a stale page landing after a filter/genre switch.
  const cursors = useRef<Record<string, number>>({});
  const doneRef = useRef<Record<string, boolean>>({});
  const seenRef = useRef<Set<string>>(new Set());
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
        setItems([]);
        setPhase("first");
      } else {
        setPhase("more");
      }
      try {
        const active = cfg.cfg.catalogs.filter(
          (c) =>
            (filter === "all" || c.type === filter) &&
            servesGenre(c, genre) &&
            !doneRef.current[c.type],
        );
        if (active.length === 0) {
          if (reqId === reqIdRef.current) setPhase("done");
          return;
        }
        const pages = await Promise.all(
          active.map((c) =>
            fetchDiscoverPage(cfg.cfg, c, genre, cursors.current[c.type] ?? 0)
              .then((page) => ({ c, page }))
              .catch(() => ({ c, page: [] as VodItem[] })),
          ),
        );
        if (reqId !== reqIdRef.current) return; // filter changed mid-flight
        for (const { c, page } of pages) {
          cursors.current[c.type] =
            (cursors.current[c.type] ?? 0) + page.length;
          if (page.length === 0) doneRef.current[c.type] = true;
        }
        const movie = pages.find((p) => p.c.type === "movie")?.page ?? [];
        const series = pages.find((p) => p.c.type === "series")?.page ?? [];
        const merged = (
          filter === "all" ? interleave(movie, series) : [...movie, ...series]
        ).filter((i) => {
          if (seenRef.current.has(i.id)) return false;
          seenRef.current.add(i.id);
          return true;
        });
        setItems((prev) => (reset ? merged : [...prev, ...merged]));
        const exhausted = pages.every(({ page }) => page.length === 0);
        setPhase(exhausted ? "done" : "idle");
      } finally {
        busyRef.current = false;
      }
    },
    [cfg, filter, genre],
  );

  // Reset + first page on any config/filter/genre change. busyRef can
  // block the reset while a stale page is in flight — bump the reqId
  // FIRST so the stale request self-discards, then retry next tick.
  useEffect(() => {
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
  }, [loadMore, phase]);

  const open = useCallback((item: VodItem) => requestOpenInStream(item), []);

  if (cfg.status === "error") {
    return (
      <div className="discover discover--empty">
        <h2>Discover</h2>
        <p className="discover__note">
          {cfg.message === "no addon configured"
            ? "Connect your AIOStreams manifest in Settings and this tab fills itself."
            : `Couldn't reach the addon — ${cfg.message}`}
        </p>
      </div>
    );
  }

  return (
    <div className="discover">
      <div className="discover__toggle">
        <ChipTabs
          tabs={FILTER_TABS}
          active={filter}
          onChange={(k) => setFilter(k)}
        />
      </div>

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
                    />
                  )}
                  <span className="genre-card__scrim" aria-hidden />
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
          <div className="disc-grid" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="disc-skel" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="discover__note">
            Nothing here — the catalog returned no titles
            {genre ? ` for ${genre}` : ""}.
          </p>
        ) : (
          <div className="disc-grid">
            {items.map((item) => (
              <Card
                key={item.id}
                item={item}
                metaFields={metaFields}
                onOpen={open}
              />
            ))}
          </div>
        )}
        {phase === "more" && <p className="discover__note">Loading more…</p>}
        <div ref={sentinelRef} className="discover__sentinel" aria-hidden />
      </section>
    </div>
  );
}
