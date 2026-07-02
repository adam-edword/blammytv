import { useEffect, useState } from "react";
import { RainbowStarIcon, StarIcon } from "../../ui/icons";
import { formatClock } from "../../lib/time";
import {
  loadClockFormat,
  onClockFormatChange,
} from "../settings/clockFormat";
import { QualityBadge } from "../../ui/QualityBadge";
import { loadFavorites, toggleFavorite } from "./favorites";
import {
  GUIDE_HOURS,
  PX_PER_MIN,
  cellRect,
  ticks,
  windowStart,
  xForTime,
} from "./guide";
import { programmesFor, type MockChannel } from "./mock";

/* Grid geometry (Figma 133:500): 189px channel cards, 8px gutters, 60px
 * rows under a 20px ruler. One scroll container; the ruler and channel
 * column pin via position:sticky, so they can never desync from the cells. */
const CARD_W = 189;
const LANE_X = CARD_W + 8;
const ROW_H = 60;
const ROW_GAP = 8;
const RULER_H = 28;
const CELL_GAP = 8;

export function Guide({
  channels,
  selectedId,
  onSelect,
}: {
  channels: Array<{ channel: MockChannel; index: number }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  // The now-line creeps and the window jumps at half-hour boundaries.
  const [now, setNow] = useState(() => new Date());
  const [clockFmt, setClockFmt] = useState(loadClockFormat);
  const [favorites, setFavorites] = useState(loadFavorites);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    const off = onClockFormatChange(setClockFmt);
    return () => {
      window.clearInterval(id);
      off();
    };
  }, []);

  const start = windowStart(now);
  const laneW = GUIDE_HOURS * 60 * PX_PER_MIN;
  const range = (from: Date, to: Date) =>
    `${formatClock(from, clockFmt)} – ${formatClock(to, clockFmt)}`;

  return (
    <div className="guide">
      <div className="guide__canvas" style={{ width: LANE_X + laneW }}>
        <div className="guide__ruler" style={{ height: RULER_H }}>
          {ticks(start).map((t) => (
            <span
              key={t.getTime()}
              className="guide__tick"
              style={{ left: LANE_X + xForTime(t, start) }}
            >
              | {formatClock(t, clockFmt)}
            </span>
          ))}
          <div className="guide__corner" style={{ width: LANE_X }} />
        </div>

        {channels.map(({ channel, index }) => {
          const selected = channel.id === selectedId;
          const favorite = favorites.includes(channel.id);
          return (
            <div
              key={channel.id}
              className="guide__row"
              // The row gap lives INSIDE the row (channel column padding),
              // so the sticky cards occlude the now-line across the gaps.
              style={{ height: ROW_H + ROW_GAP }}
            >
              {/* Cells first so the sticky card paints above them. */}
              {channel.noInfo ? (
                <button
                  type="button"
                  className="guide__cell guide__cell--blank"
                  style={{
                    left: LANE_X,
                    width: laneW - CELL_GAP,
                    height: ROW_H,
                  }}
                  onClick={() => onSelect(channel.id)}
                >
                  <span
                    className="guide__cell-body"
                    style={{ left: LANE_X + 16 }}
                  >
                    No Information
                  </span>
                </button>
              ) : (
                programmesFor(index, now).map((p) => {
                  const rect = cellRect(p.start, p.end, start);
                  if (!rect) return null;
                  const live = p.start <= now && now < p.end;
                  return (
                    <button
                      key={p.start.getTime()}
                      type="button"
                      className={
                        "guide__cell" + (live ? " guide__cell--live" : "")
                      }
                      style={{
                        left: LANE_X + rect.x,
                        width: Math.max(rect.w - CELL_GAP, 4),
                        height: ROW_H,
                      }}
                      onClick={() => onSelect(channel.id)}
                    >
                      {/* Sticky: hugs the scrollport's left edge until the
                       * cell's far edge pushes it away. */}
                      <span
                        className="guide__cell-body"
                        style={{ left: LANE_X + 16 }}
                      >
                        <span className="guide__cell-title">{p.title}</span>
                        <span className="guide__cell-time">
                          {range(p.start, p.end)}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}

              <div
                className={
                  "guide__channel" +
                  (selected ? " guide__channel--selected" : "")
                }
              >
                <button
                  type="button"
                  className="guide__card"
                  onClick={() => onSelect(channel.id)}
                >
                  <span className="guide__logo" aria-hidden>
                    {channel.name[0]}
                  </span>
                  <span className="guide__card-meta">
                    <span className="guide__card-name">{channel.name}</span>
                    <QualityBadge quality={channel.quality} />
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    "guide__fav" + (favorite ? " guide__fav--on" : "")
                  }
                  aria-label={
                    favorite
                      ? `Remove ${channel.name} from favorites`
                      : `Add ${channel.name} to favorites`
                  }
                  aria-pressed={favorite}
                  onClick={() =>
                    setFavorites((list) => toggleFavorite(list, channel.id))
                  }
                >
                  {favorite ? <RainbowStarIcon /> : <StarIcon />}
                </button>
              </div>
            </div>
          );
        })}

        <div
          className="guide__nowline"
          style={{ left: LANE_X + xForTime(now, start), top: RULER_H }}
          aria-hidden
        />
      </div>
    </div>
  );
}
