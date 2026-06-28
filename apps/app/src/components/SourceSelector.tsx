import { useEffect, useState, type CSSProperties } from "react";
import {
  FocusContext,
  setFocus,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import type { ShareCode, VodItem, StreamSource } from "@blammytv/shared";
import { SourceCard } from "./SourceCard";
import { FocusButton } from "./FocusButton";
import type { TheaterMeta } from "./Player";
import { ChevronIcon } from "./icons";
import { fetchVodSources, gradientFor, vodBackendConfigured } from "../lib/vod";

/** Stable focus key for one source row. */
const sourceKey = (id: string) => `src-${id}`;
const BACK_KEY = "detail-back";

/** The source-selection page: a full-bleed backdrop with the title's info on
 * the left and the backend-ranked source list on the right. Used for movies
 * and for a chosen series episode (with a Season/Episode context line).
 *
 * Sources are resolved on-demand: when this opens it asks the backend for the
 * ranked list for `sourceKind`/`sourceId` (a movie id, or an episode's
 * `tt…:s:e`). In demo mode it just renders `fallbackSources` from the blob. */
export function SourceSelector({
  item,
  shareCode,
  sourceKind,
  sourceId,
  fallbackSources = [],
  episodeLabel = null,
  episodeTitle = null,
  onBack,
  onPlay,
}: {
  item: VodItem;
  shareCode: ShareCode;
  sourceKind: VodItem["kind"];
  sourceId: string;
  fallbackSources?: StreamSource[];
  episodeLabel?: string | null;
  episodeTitle?: string | null;
  onBack: () => void;
  onPlay: (
    url: string,
    meta: TheaterMeta,
    ctx: { item: VodItem; episodeId?: string },
  ) => void;
}) {
  // null = still resolving; [] = resolved but nothing available.
  const [sources, setSources] = useState<StreamSource[] | null>(
    vodBackendConfigured() ? null : fallbackSources,
  );
  const [failed, setFailed] = useState(false);

  // The source rail is a vertical focus group (▲/▼ between sources); ◀/▲ off the
  // list reaches the Back button, which sits outside the group.
  const { ref: railRef, focusKey: railFocusKey } = useFocusable<HTMLElement>({
    saveLastFocusedChild: true,
    trackChildren: true,
  });

  // Land focus on the first source as soon as the list resolves (forward nav
  // doesn't auto-restore focus); fall back to Back when there's nothing to pick.
  useEffect(() => {
    const target =
      sources && sources.length > 0 ? sourceKey(sources[0].id) : BACK_KEY;
    const id = requestAnimationFrame(() => setFocus(target));
    return () => cancelAnimationFrame(id);
  }, [sources]);

  useEffect(() => {
    if (!vodBackendConfigured()) {
      setSources(fallbackSources);
      return;
    }
    let alive = true;
    setSources(null);
    setFailed(false);
    fetchVodSources(shareCode, sourceKind, sourceId)
      .then((s) => alive && setSources(s))
      .catch(() => {
        if (alive) {
          setSources([]);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
    // fallbackSources is stable per screen; resolution keys off id/kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareCode, sourceKind, sourceId]);

  // Backspace / Escape backs out — natural on a remote and a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const backdrop = item.backdrop ?? item.poster;
  const backdropStyle: CSSProperties = backdrop
    ? { backgroundImage: `url(${backdrop})` }
    : { background: gradientFor(item.id) };

  const meta = [
    item.year,
    item.runtimeMin ? `${item.runtimeMin} min` : null,
    item.kind === "series" ? "Series" : "Movie",
    item.rating != null ? `★ ${item.rating.toFixed(1)}/10` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  // What the player overlay shows for a chosen source.
  const playMeta = (s: StreamSource): TheaterMeta => ({
    logo: item.logo,
    backdrop: item.backdrop ?? item.poster,
    channelName: [
      item.year,
      item.kind === "series" ? "Series" : "Movie",
      `${s.quality}${s.cached ? " ⚡" : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
    title: episodeTitle ? `${item.title} — ${episodeTitle}` : item.title,
    description: episodeLabel ?? item.synopsis,
    progressPct: 0,
    live: false,
    kind: "vod",
  });

  return (
    <div className="detail">
      <div className="detail__backdrop" style={backdropStyle} />
      <div className="detail__scrim" />

      <div className="detail__body">
        <FocusButton
          className="detail__back"
          focusKey={BACK_KEY}
          onPress={onBack}
        >
          <ChevronIcon className="detail__back-icon" />
          Back
        </FocusButton>

        <div className="detail__info">
          {item.logo ? (
            <img className="detail__logo" src={item.logo} alt={item.title} />
          ) : (
            <h1 className="detail__title">{item.title}</h1>
          )}
          {episodeLabel && (
            <p className="detail__episode">
              <span className="detail__episode-label">{episodeLabel}</span>
              {episodeTitle && (
                <span className="detail__episode-title">{episodeTitle}</span>
              )}
            </p>
          )}
          {item.synopsis && <p className="detail__synopsis">{item.synopsis}</p>}
          <p className="detail__meta">{meta}</p>

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
                {item.cast.map((c, i) => (
                  <span key={i} className="pill">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <FocusContext.Provider value={railFocusKey}>
          <aside className="detail__rail" aria-label="Sources" ref={railRef}>
            {sources === null ? (
              <p className="detail__no-sources">Finding sources…</p>
            ) : sources.length === 0 ? (
              <p className="detail__no-sources">
                {failed ? "Couldn't load sources." : "No sources available."}
              </p>
            ) : (
              sources.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  focusKey={sourceKey(s.id)}
                  onPlay={() =>
                    onPlay(s.streamUrl, playMeta(s), {
                      item,
                      episodeId: sourceKind === "series" ? sourceId : undefined,
                    })
                  }
                />
              ))
            )}
          </aside>
        </FocusContext.Provider>
      </div>
    </div>
  );
}
