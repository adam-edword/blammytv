import { useEffect, useMemo, useState } from "react";
import { QualityBadge } from "../../ui/QualityBadge";
import { RecentsIcon, StarIcon } from "../../ui/icons";
import { formatClock } from "../../lib/time";
import { loadClockFormat } from "../settings/clockFormat";
import {
  GUIDE_HOURS,
  PX_PER_MIN,
  cellRect,
  progress,
  ticks,
  windowStart,
  xForTime,
} from "./guide";
import {
  MOCK_CHANNELS,
  MOCK_FOLDERS,
  MOCK_PLAYLIST_NAME,
  programmesFor,
  type MockChannel,
  type Programme,
} from "./mock";
import { loadFavorites, toggleFavorite } from "./favorites";

type Mode = "playlist" | "favorites" | "recents";

/** Minute-accurate clock driving the now-line and hero progress. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function LiveScreen() {
  const now = useNow();
  const start = useMemo(() => windowStart(now), [now]);

  const [mode, setMode] = useState<Mode>("playlist");
  const [folder, setFolder] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [selectedId, setSelectedId] = useState(MOCK_CHANNELS[0].id);

  // The guide is mock-powered in v0.1.0 — real playlists arrive next.
  const guide = useMemo(
    () =>
      MOCK_CHANNELS.map((channel, i) => ({
        channel,
        programmes: channel.noInfo ? [] : programmesFor(i, now),
      })),
    [now],
  );

  const rows = guide.filter(({ channel }) => {
    if (mode === "favorites") return favorites.includes(channel.id);
    if (mode === "recents") return false;
    return folder === null || channel.folder === folder;
  });

  const selected =
    guide.find((r) => r.channel.id === selectedId) ?? guide[0];
  const airing = selected.programmes.find(
    (p) => p.start <= now && now < p.end,
  );

  const star = (id: string) => setFavorites(toggleFavorite(favorites, id));

  return (
    <div className="live">
      <aside className="live-sidebar">
        <div className="live-sidebar__modes">
          <button
            type="button"
            className={
              "live-mode live-mode--label" +
              (mode === "playlist" ? " live-mode--active" : "")
            }
            onClick={() => setMode("playlist")}
          >
            Playlist
          </button>
          <button
            type="button"
            className={
              "live-mode" + (mode === "favorites" ? " live-mode--active" : "")
            }
            aria-label="Favorites"
            onClick={() => setMode("favorites")}
          >
            <StarIcon />
          </button>
          <button
            type="button"
            className={
              "live-mode" + (mode === "recents" ? " live-mode--active" : "")
            }
            aria-label="Recents"
            onClick={() => setMode("recents")}
          >
            <RecentsIcon />
          </button>
        </div>

        {/* In ★/⏱ modes the folder list collapses; the guide takes the width. */}
        {mode === "playlist" && (
          <>
            <p className="live-sidebar__playlist">{MOCK_PLAYLIST_NAME}</p>
            <div className="live-sidebar__folders">
              {MOCK_FOLDERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={
                    "live-folder" + (folder === f ? " live-folder--active" : "")
                  }
                  onClick={() => setFolder(folder === f ? null : f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      <div className="live-main">
        <Hero channel={selected.channel} airing={airing} now={now} />

        {rows.length === 0 ? (
          <div className="live-empty">
            <p className="live-empty__note">
              {mode === "favorites"
                ? "Star a channel in the guide to pin it here."
                : "Channels you watch will show up here."}
            </p>
          </div>
        ) : (
          <Guide
            rows={rows}
            start={start}
            now={now}
            favorites={favorites}
            selectedId={selected.channel.id}
            onSelect={setSelectedId}
            onStar={star}
          />
        )}
      </div>
    </div>
  );
}

function Hero({
  channel,
  airing,
  now,
}: {
  channel: MockChannel;
  airing: Programme | undefined;
  now: Date;
}) {
  const fmt = loadClockFormat();
  return (
    <div className="live-hero">
      <div className="live-hero__preview">
        <span className="live-hero__preview-note">Preview</span>
      </div>
      <div className="live-hero__info">
        <span className="live-badge">
          <span className="live-badge__dot" />
          LIVE
        </span>
        <p className="live-hero__channel">{channel.name}</p>
        <h2 className="live-hero__title">
          {airing ? airing.title : "No programme information"}
        </h2>
        {airing && (
          <>
            <p className="live-hero__synopsis">{airing.synopsis}</p>
            <div className="live-hero__meta">
              <span className="live-hero__time">
                {formatClock(airing.start, fmt)} – {formatClock(airing.end, fmt)}
              </span>
              <div className="live-hero__bar">
                <div
                  className="live-hero__bar-fill"
                  style={{
                    width: `${progress(airing.start, airing.end, now) * 100}%`,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Guide({
  rows,
  start,
  now,
  favorites,
  selectedId,
  onSelect,
  onStar,
}: {
  rows: Array<{ channel: MockChannel; programmes: Programme[] }>;
  start: Date;
  now: Date;
  favorites: string[];
  selectedId: string;
  onSelect: (id: string) => void;
  onStar: (id: string) => void;
}) {
  const fmt = loadClockFormat();
  const gridW = GUIDE_HOURS * 60 * PX_PER_MIN;
  const nowX = xForTime(now, start);

  return (
    <div className="guide">
      <div className="guide__scroll">
        <div
          className="guide__inner"
          style={{ width: `calc(var(--guide-channel-w) + ${gridW}px)` }}
        >
          {/* Timeline header */}
          <div className="guide__timeline">
            <div className="guide__corner" />
            <div className="guide__ticks">
              {ticks(start).map((t) => (
                <span
                  key={t.getTime()}
                  className="guide__tick"
                  style={{ left: xForTime(t, start) }}
                >
                  | {formatClock(t, fmt)}
                </span>
              ))}
            </div>
          </div>

          <div className="guide__rows">
            {/* The now-line spans every row. */}
            <div
              className="guide__now"
              style={{ left: `calc(var(--guide-channel-w) + ${nowX}px)` }}
            />

            {rows.map(({ channel, programmes }) => (
              <div key={channel.id} className="guide-row">
                <div
                  className={
                    "guide-channel" +
                    (channel.id === selectedId ? " guide-channel--active" : "")
                  }
                  onClick={() => onSelect(channel.id)}
                >
                  <span className="guide-channel__logo" aria-hidden>
                    {channel.name
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")}
                  </span>
                  <span className="guide-channel__text">
                    <span className="guide-channel__name">{channel.name}</span>
                    <QualityBadge quality={channel.quality} />
                  </span>
                  <button
                    type="button"
                    className={
                      "guide-channel__star" +
                      (favorites.includes(channel.id)
                        ? " guide-channel__star--on"
                        : "")
                    }
                    aria-label={`Favorite ${channel.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStar(channel.id);
                    }}
                  >
                    <StarIcon />
                  </button>
                </div>

                <div className="guide-row__cells">
                  {programmes.length === 0 ? (
                    <div className="guide-cell guide-cell--noinfo">
                      No Information
                    </div>
                  ) : (
                    programmes.map((p) => {
                      const rect = cellRect(p.start, p.end, start);
                      if (!rect) return null;
                      const isAiring = p.start <= now && now < p.end;
                      return (
                        <div
                          key={p.start.getTime()}
                          className={
                            "guide-cell" +
                            (isAiring ? " guide-cell--airing" : "")
                          }
                          style={{ left: rect.x, width: rect.w - 6 }}
                          onClick={() => onSelect(channel.id)}
                        >
                          <span className="guide-cell__title">{p.title}</span>
                          <span className="guide-cell__time">
                            {formatClock(p.start, fmt)} –{" "}
                            {formatClock(p.end, fmt)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
