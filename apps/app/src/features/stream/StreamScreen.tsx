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
  const [playing, setPlaying] = useState<{
    url: string;
    item: VodItem;
    label?: string;
  } | null>(null);

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

  // ---- Playback: fullscreen through the shared inverted player. The
  // overlay's meta is minimal VOD shape (live:false, no programme). ----
  const stop = useCallback(() => {
    setPlaying(null);
    if (isTauri()) void tauriSetFullscreen(false).catch(() => {});
  }, []);
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
      {view.at === "home" && <Home load={load} onOpen={open} />}
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

function Home({ load, onOpen }: { load: Load; onOpen: (i: VodItem) => void }) {
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
      {featured.length > 0 && <Hero items={featured} onOpen={onOpen} />}
      <div className="stream__rows">
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

/** Auto-advancing featured carousel (7s), dot pager, backdrop-first. */
function Hero({
  items,
  onOpen,
}: {
  items: VodItem[];
  onOpen: (i: VodItem) => void;
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      7000,
    );
    return () => window.clearInterval(id);
  }, [items.length]);
  const item = items[index % items.length];
  if (!item) return null;
  return (
    <button type="button" className="stream-hero" onClick={() => onOpen(item)}>
      {(item.backdrop ?? item.poster) && (
        <img
          className="stream-hero__art"
          src={item.backdrop ?? item.poster}
          alt=""
        />
      )}
      <div className="stream-hero__scrim" aria-hidden />
      <div className="stream-hero__text">
        <span className="stream-hero__kind">
          {item.kind === "series" ? "Series" : "Movie"}
          {item.year ? ` · ${item.year}` : ""}
        </span>
        <h2 className="stream-hero__title">{item.title}</h2>
        {item.synopsis && (
          <p className="stream-hero__synopsis">{item.synopsis}</p>
        )}
      </div>
      <div className="stream-hero__dots" aria-hidden>
        {items.map((x, i) => (
          <i key={x.id} className={i === index % items.length ? "on" : ""} />
        ))}
      </div>
    </button>
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
