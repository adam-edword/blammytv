import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTauri, tauriSetFullscreen } from "../../lib/tauri";
import { setOverlayApiOverride } from "../live/overlayApi";
import { InvertedPlayer } from "../live/InvertedPlayer";
import { TheaterOverlay } from "../live/TheaterOverlay";
import { useDirectOverlay } from "../live/useDirectOverlay";
import type { StreamSource, VodData, VodItem } from "./model";
import { loadVod, peekVod, resolveVodItem, resolveVodSources } from "./source";
import { loadAioUrl } from "../settings/aiostreams";
import {
  clearWatching,
  loadWatching,
  recordWatching,
  type WatchEntry,
} from "./watching";

/**
 * The Stream tab: AIOStreams-powered movies + series. A featured hero, then
 * poster rows; click through to a detail page whose right rail lists the
 * addon's pre-ranked sources; picking one plays fullscreen through the same
 * inverted-layer player Live uses. Ported in spirit from the old build's
 * StreamScreen/SourceSelector/EpisodeBrowser trio, restyled to the rebuild.
 * (VOD scrubber chrome is the next phase — j/l/arrow seeks already work
 * through the shared overlay's keys.)
 */

type View =
  | { at: "home" }
  | { at: "title"; item: VodItem }
  | { at: "episodes"; item: VodItem }
  | { at: "sources"; item: VodItem; episodeId?: string; episodeLabel?: string };

type Load =
  | { status: "loading" }
  | { status: "ready"; data: VodData }
  | { status: "error"; message: string };

export function StreamScreen() {
  const [load, setLoad] = useState<Load>(() => {
    const cached = peekVod();
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [view, setView] = useState<View>({ at: "home" });
  const [playing, setPlayingRaw] = useState<{
    url: string;
    item: VodItem;
    label?: string;
  } | null>(null);
  const [watching, setWatching] = useState<WatchEntry[]>(loadWatching);
  const setPlaying = useCallback(
    (p: { url: string; item: VodItem; label?: string; episodeId?: string } | null) => {
      setPlayingRaw(p);
      if (p)
        setWatching(
          recordWatching({
            id: p.item.id,
            episodeId: p.episodeId,
            title: p.item.title,
            label: p.label,
            art: p.item.backdrop ?? p.item.poster,
            rating: p.item.rating,
            year: p.item.year,
            runtimeMin: p.item.runtimeMin,
            at: Date.now(),
          }),
        );
    },
    [],
  );

  useEffect(() => {
    let stale = false;
    loadVod().then(
      (data) =>
        !stale &&
        setLoad(
          data.error
            ? { status: "error", message: data.error }
            : { status: "ready", data },
        ),
      (e) =>
        !stale &&
        setLoad({
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
    );
    return () => {
      stale = true;
    };
  }, []);

  const open = useCallback(async (item: VodItem) => {
    // Show the lightweight item immediately; swap in the full detail
    // (synopsis, cast, seasons) when it lands. Failure keeps the light one.
    setView(
      item.kind === "series" ? { at: "episodes", item } : { at: "title", item },
    );
    try {
      const full = await resolveVodItem(item.kind, item.id);
      if (full)
        setView((v) =>
          (v.at === "title" || v.at === "episodes") && v.item.id === item.id
            ? { ...v, item: full }
            : v,
        );
    } catch {
      /* best-effort: the light item still renders */
    }
  }, []);

  // Hero "Watch Now": resolve fresh sources and play the best one straight
  // away (first cached — the addon's ranking within that — else first
  // overall). No sources → fall through to the detail page instead.
  const watchNow = useCallback(
    async (item: VodItem) => {
      if (item.kind === "series") return open(item); // series always browse
      try {
        const sources = await resolveVodSources("movie", item.id);
        const pick = sources.find((s) => s.cached) ?? sources[0];
        if (pick) return setPlaying({ url: pick.streamUrl, item });
      } catch {
        /* fall through to detail */
      }
      void open(item);
    },
    [open, setPlaying],
  );

  // ---- Playback: fullscreen through the shared inverted player. The
  // overlay's meta is minimal VOD shape (live:false, no programme). ----
  const stop = useCallback(() => {
    setPlaying(null);
    if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
  }, [setPlaying]);
  const playMeta = playing
    ? {
        channelName: playing.item.title,
        logo: playing.item.logo ?? playing.item.poster,
        title: playing.label ?? playing.item.title,
        description: playing.item.synopsis,
        live: false,
      }
    : null;
  const directApi = useDirectOverlay(
    isTauri() && !!playing,
    playing?.url ?? null,
    playMeta,
    {
      onClose: stop,
      onExpand: () => {},
      onCollapse: stop, // t / collapse = leave playback back to the catalog
      onFullscreen: () => {},
      onExitFullscreen: stop,
      onPopout: () => {},
      onToggleFavorite: () => {},
    },
  );
  if (isTauri() && playing) setOverlayApiOverride(directApi);
  const chromeHostRef = useRef<HTMLDivElement | null>(null);
  if (isTauri() && !chromeHostRef.current) {
    const host = document.createElement("div");
    host.id = "inv-chrome";
    chromeHostRef.current = host;
  }
  useEffect(() => {
    const host = chromeHostRef.current;
    if (!host || !playing) return;
    document.body.appendChild(host);
    void tauriSetFullscreen(true).catch(() => {});
    return () => {
      host.remove();
    };
  }, [playing]);

  if (playing && isTauri()) {
    return (
      <div className="vod-stage">
        <div id="player-slot" className="vod-stage__slot" />
        <InvertedPlayer url={playing.url} squared />
        {chromeHostRef.current &&
          createPortal(
            <TheaterOverlay frame="fullscreen" playbackKey={playing.url} />,
            chromeHostRef.current,
          )}
      </div>
    );
  }

  return (
    <div className="stream">
      {view.at === "home" && (
        <Home
          load={load}
          onOpen={open}
          onWatchNow={watchNow}
          watching={watching}
          onClearWatching={(id) => setWatching(clearWatching(id))}
          onOpenWatching={(e) => {
            const item = load.status === "ready" ? load.data.items.get(e.id) : undefined;
            if (item) void open(item);
          }}
        />
      )}
      {view.at === "title" && (
        <Detail
          item={view.item}
          onBack={() => setView({ at: "home" })}
          onPlaySource={(s) =>
            setPlaying({ url: s.streamUrl, item: view.item })
          }
        />
      )}
      {view.at === "episodes" && (
        <Episodes
          item={view.item}
          onBack={() => setView({ at: "home" })}
          onPick={(episodeId, episodeLabel) =>
            setView({ at: "sources", item: view.item, episodeId, episodeLabel })
          }
        />
      )}
      {view.at === "sources" && (
        <Detail
          item={view.item}
          episodeId={view.episodeId}
          episodeLabel={view.episodeLabel}
          onBack={() => setView({ at: "episodes", item: view.item })}
          onPlaySource={(s) =>
            setPlaying({
              url: s.streamUrl,
              item: view.item,
              label: view.episodeLabel,
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Home({
  load,
  onOpen,
  onWatchNow,
  watching,
  onClearWatching,
  onOpenWatching,
}: {
  load: Load;
  onOpen: (i: VodItem) => void;
  onWatchNow: (i: VodItem) => void;
  watching: WatchEntry[];
  onClearWatching: (id: string) => void;
  onOpenWatching: (e: WatchEntry) => void;
}) {
  if (!loadAioUrl()) {
    return (
      <div className="stream__note">
        <h2>Movies and shows, one tab over from live.</h2>
        <p>
          Paste your AIOStreams manifest URL in Settings → AIOStreams and the
          catalog appears here.
        </p>
      </div>
    );
  }
  if (load.status === "loading")
    return (
      <div className="stream__note stream__note--dim">Loading your catalog…</div>
    );
  if (load.status === "error")
    return (
      <div className="stream__note">
        <h2>Couldn't load your catalog.</h2>
        <p>{load.message}. Check the manifest URL in Settings → AIOStreams.</p>
      </div>
    );
  const { data } = load;
  const featured = data.featured
    .map((id) => data.items.get(id))
    .filter((v): v is VodItem => !!v);
  return (
    <>
      {featured.length > 0 && (
        <Hero items={featured} onOpen={onOpen} onWatchNow={onWatchNow} />
      )}
      <div className="stream__rows">
        {watching.length > 0 && (
          <section className="media-row">
            <h3 className="media-row__title">Continue Watching</h3>
            <div className="media-row__scroller">
              {watching.map((e) => (
                <ContinueCard
                  key={e.id}
                  entry={e}
                  onOpen={() => onOpenWatching(e)}
                  onClear={() => onClearWatching(e.id)}
                />
              ))}
            </div>
          </section>
        )}
        {data.rows.map((row) => (
          <section key={row.id} className="media-row">
            <h3 className="media-row__title">{row.title}</h3>
            <div className="media-row__scroller">
              {row.itemIds.map((id) => {
                const item = data.items.get(id);
                return item ? <Card key={id} item={item} onOpen={onOpen} /> : null;
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** The Figma hero (133-721): a ~90vh sliding carousel that never rewinds.
 * The index is VIRTUAL (unbounded, forward-only on auto-advance); slides
 * are a moving window of absolute-positioned cards, each showing
 * items[slot mod n] — so wrapping from the 9th back to the 1st is just one
 * more slide to the right, forever. Hovering the section pauses the
 * auto-advance; the active card wears the Figma glow; neighbors stay at
 * full strength and click-slide. */
const HERO_GAP = 30;
function heroMargin(w: number): number {
  // Side inset ≈ 15% of the window, clamped sane — the card is ~15%
  // thinner than full-bleed and the neighbors fill the reveal.
  return Math.min(320, Math.max(200, w * 0.15));
}
function Hero({
  items,
  onOpen,
  onWatchNow,
}: {
  items: VodItem[];
  onOpen: (i: VodItem) => void;
  onWatchNow: (i: VodItem) => void;
}) {
  const [v, setV] = useState(0); // virtual index — never wraps
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const count = items.length;
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (hovered || count < 2) return;
    const id = window.setInterval(() => setV((x) => x + 1), 8000);
    return () => window.clearInterval(id);
  }, [hovered, count]);

  const m = heroMargin(width);
  const cardW = Math.max(0, width - 2 * m);
  const step = cardW + HERO_GAP;

  // Window of live slots around the current one: both neighbors visible,
  // one extra each side so a slide-in mounts before it enters the frame.
  // One extra slot AHEAD of the window: the next-next card mounts and
  // decodes ~8s before it ever enters the frame, so a slide never pays
  // an image decode mid-animation.
  const slots = [v - 2, v - 1, v, v + 1, v + 2, v + 3];
  return (
    <div
      className="shero"
      ref={hostRef}
      role="region"
      aria-label="Featured"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Adam's shadow slider: the same carousel again, blurred, masked
        * to the stationary (android-style) box behind the center slot.
        * The box never moves — the blurred art sliding through it IS the
        * ambient light reacting to the cards, in exact lockstep (same
        * geometry, same transition). The inner track's offset subtracts
        * the box's own left so both tracks align in screen space. */}
      <div
        className="shero__glowbox"
        aria-hidden
        style={{ left: m - 90, width: cardW + 180 }}
      >
        <div
          className="shero__glowtrack"
          style={{ transform: `translateX(${90 - v * step}px)` }}
        >
          {slots.map((slot) => {
            const item = items[((slot % count) + count) % count];
            const art = item?.backdrop ?? item?.poster;
            return art ? (
              <img
                key={slot}
                className={slot === v ? "shero__glow--lit" : undefined}
                src={art}
                alt=""
                decoding="async"
                style={{ left: slot * step, width: cardW }}
              />
            ) : null;
          })}
        </div>
      </div>
      <div
        className="shero__track"
        style={{ transform: `translateX(${m - v * step}px)` }}
      >
        {slots.map((slot) => {
          const item = items[((slot % count) + count) % count];
          if (!item) return null;
          const active = slot === v;
          return (
            <div
              key={slot}
              role="button"
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => {
                if (active && (e.key === "Enter" || e.key === " ")) onOpen(item);
              }}
              className={"shero__card" + (active ? " shero__card--active" : "")}
              style={{ left: slot * step, width: cardW }}
              // Whole-card click: neighbors slide into place; the ACTIVE
              // card opens the title's source-selection screen (the
              // buttons stopPropagation, so Watch Now stays instant-play).
              onClick={() => (active ? onOpen(item) : setV(slot))}
            >
              {(item.backdrop ?? item.poster) && (
                <img
                  className="shero__art"
                  src={item.backdrop ?? item.poster}
                  alt=""
                  decoding="async"
                />
              )}
              <div className="shero__scrim" aria-hidden />
              <div className="shero__text">
                {item.logo ? (
                  <img
                    className="shero__logo"
                    src={item.logo}
                    alt={item.title}
                  />
                ) : (
                  <h2 className="shero__title">{item.title}</h2>
                )}
                {item.synopsis && (
                  <p className="shero__synopsis">{item.synopsis}</p>
                )}
                <p className="shero__meta">
                  {[
                    item.year,
                    item.runtimeMin ? `${item.runtimeMin} min` : null,
                    item.kind === "series" ? "Series" : "Movie",
                  ]
                    .filter(Boolean)
                    .join("   ")}
                  {item.rating ? (
                    <span className="shero__rating">
                      {" "}
                      ★ {item.rating.toFixed(1)}/10
                    </span>
                  ) : null}
                </p>
                <div className="shero__actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWatchNow(item);
                    }}
                  >
                    Watch Now
                  </button>
                  <button
                    type="button"
                    className="shero__btn-quiet"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(item);
                    }}
                  >
                    More Info
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ item, onOpen }: { item: VodItem; onOpen: (i: VodItem) => void }) {
  return (
    <button type="button" className="stream-card" onClick={() => onOpen(item)}>
      {item.poster ? (
        <img
          className="stream-card__poster"
          src={item.poster}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="stream-card__mono">{item.title.slice(0, 1)}</span>
      )}
      <span className="stream-card__name">{item.title}</span>
      <span className="stream-card__meta">
        {[
          item.rating ? item.rating.toFixed(1) : null,
          item.year,
          item.runtimeMin ? `${item.runtimeMin} min` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </button>
  );
}

/** Continue Watching card: landscape art, meta line, HOLD to clear (the
 * Figma interaction — a click opens, a ~1s press-and-hold removes). */
function ContinueCard({
  entry,
  onOpen,
  onClear,
}: {
  entry: WatchEntry;
  onOpen: () => void;
  onClear: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const held = useRef(false);
  const start = () => {
    held.current = false;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setHolding(false);
      onClear();
    }, 1000);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    <button
      type="button"
      className={"continue-card" + (holding ? " continue-card--holding" : "")}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={() => {
        if (!held.current) onOpen();
      }}
    >
      {entry.art ? (
        <img className="continue-card__art" src={entry.art} alt="" loading="lazy" />
      ) : (
        <span className="continue-card__art continue-card__art--empty" />
      )}
      <span className="continue-card__hold" aria-hidden>
        Keep holding to clear
      </span>
      <span className="stream-card__name">{entry.title}</span>
      <span className="stream-card__meta">
        {[
          entry.rating ? entry.rating.toFixed(1) : null,
          entry.year,
          entry.runtimeMin ? `${entry.runtimeMin} min` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

/** Detail page: backdrop + info left, the addon's pre-ranked sources right.
 * For an episode, `episodeId` scopes the source resolve. Sources re-resolve
 * on every open — debrid links can be short-lived. */
function Detail({
  item,
  episodeId,
  episodeLabel,
  onBack,
  onPlaySource,
}: {
  item: VodItem;
  episodeId?: string;
  episodeLabel?: string;
  onBack: () => void;
  onPlaySource: (s: StreamSource) => void;
}) {
  const [sources, setSources] = useState<StreamSource[] | null | "failed">(
    null,
  );
  useEffect(() => {
    let stale = false;
    setSources(null);
    resolveVodSources(item.kind, episodeId ?? item.id).then(
      (s) => !stale && setSources(s),
      () => !stale && setSources("failed"),
    );
    return () => {
      stale = true;
    };
  }, [item.kind, item.id, episodeId]);

  return (
    <div className="vod-detail">
      {item.backdrop && (
        <img className="vod-detail__backdrop" src={item.backdrop} alt="" />
      )}
      <div className="vod-detail__scrim" aria-hidden />
      <div className="vod-detail__body">
        <div className="vod-detail__info">
          <button type="button" className="vod-back" onClick={onBack}>
            ← Back
          </button>
          {item.logo ? (
            <img className="vod-detail__logo" src={item.logo} alt={item.title} />
          ) : (
            <h2 className="vod-detail__title">{item.title}</h2>
          )}
          {episodeLabel && <p className="vod-detail__episode">{episodeLabel}</p>}
          <p className="vod-detail__meta">
            {[
              item.year,
              item.runtimeMin ? `${item.runtimeMin} min` : null,
              item.rating ? `★ ${item.rating.toFixed(1)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {item.synopsis && (
            <p className="vod-detail__synopsis">{item.synopsis}</p>
          )}
          {item.genres.length > 0 && (
            <div className="vod-detail__pills">
              {item.genres.slice(0, 5).map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
          )}
        </div>
        <div className="vod-sources">
          <h3>Sources</h3>
          {sources === null && (
            <p className="vod-sources__note">Finding sources…</p>
          )}
          {sources === "failed" && (
            <p className="vod-sources__note">Couldn't load sources.</p>
          )}
          {Array.isArray(sources) && sources.length === 0 && (
            <p className="vod-sources__note">No sources available.</p>
          )}
          {Array.isArray(sources) &&
            sources.map((s) => (
              <button
                key={s.id}
                type="button"
                className="vod-source"
                onClick={() => onPlaySource(s)}
              >
                <span className="vod-source__quality">
                  {s.cached && <span className="vod-source__zap">⚡</span>}
                  {s.quality}
                </span>
                <span className="vod-source__lines">
                  {s.lines.slice(0, 2).map((l, i) => (
                    <span key={i}>{l}</span>
                  ))}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Episodes({
  item,
  onBack,
  onPick,
}: {
  item: VodItem;
  onBack: () => void;
  onPick: (episodeId: string, label: string) => void;
}) {
  const [seasonIdx, setSeasonIdx] = useState(0);
  const season =
    item.seasons[Math.min(seasonIdx, Math.max(0, item.seasons.length - 1))];
  return (
    <div className="vod-detail">
      {item.backdrop && (
        <img className="vod-detail__backdrop" src={item.backdrop} alt="" />
      )}
      <div className="vod-detail__scrim" aria-hidden />
      <div className="vod-detail__body vod-detail__body--episodes">
        <div className="vod-detail__info">
          <button type="button" className="vod-back" onClick={onBack}>
            ← Back
          </button>
          <h2 className="vod-detail__title">{item.title}</h2>
          {item.synopsis && (
            <p className="vod-detail__synopsis">{item.synopsis}</p>
          )}
        </div>
        {item.seasons.length === 0 ? (
          <p className="vod-sources__note">Loading episodes…</p>
        ) : (
          <>
            <div className="season-bar">
              {item.seasons.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={
                    "season-chip" + (i === seasonIdx ? " season-chip--on" : "")
                  }
                  onClick={() => setSeasonIdx(i)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="episode-grid">
              {season?.episodes.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="episode-card"
                  onClick={() =>
                    onPick(e.id, `S${season.number} · E${e.number} — ${e.title}`)
                  }
                >
                  {e.still && <img src={e.still} alt="" loading="lazy" />}
                  <span className="episode-card__num">E{e.number}</span>
                  <span className="episode-card__title">{e.title}</span>
                  {e.airDate && (
                    <span className="episode-card__date">{e.airDate}</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
