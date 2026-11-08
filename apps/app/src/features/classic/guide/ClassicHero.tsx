import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatClock } from "../../../lib/time";
import { ChannelLogo } from "../../../ui/ChannelLogo";
import { loadClockFormat, onClockFormatChange } from "../../settings/clockFormat";
import { loadShowChannelNumber, onShowChannelNumberChange } from "../../settings/channelNumber";
import type { Channel, Programme } from "../../live/model";

/** Now Playing as Classic draws it: a sunken black preview frame with the
 * channel's text beside it, and Classic buttons for Watch, Record and
 * Favorites. Takes what Hero takes, plus the actions LiveScreen already has.
 *
 * `#player-slot` keeps its own class and id inside the frame, so the native
 * player's rect, its clip hole and the theater and fullscreen geometry
 * (live.css) find it exactly as they find Hero's. The frame only dresses the
 * outside of it. */
export function ClassicHero({
  channel,
  programmes,
  programme,
  folderName,
  favorite,
  onWatch,
  onToggleFavorite,
  record,
  onBackdropClick,
}: {
  channel: Channel;
  programmes: Programme[];
  /** A hovered programme, which overrides the airing one (as in Hero). */
  programme?: Programme;
  folderName?: string;
  favorite: boolean;
  /** Absent for a recording, which has no channel to tune or star. */
  onWatch?: () => void;
  onToggleFavorite?: () => void;
  /** The Record button, built by the screen (it knows the line and the link). */
  record?: ReactNode;
  onBackdropClick?: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [clockFmt, setClockFmt] = useState(loadClockFormat);
  const [showNumber, setShowNumber] = useState(loadShowChannelNumber);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    const off = onClockFormatChange(setClockFmt);
    const offNum = onShowChannelNumberChange(setShowNumber);
    return () => {
      window.clearInterval(id);
      off();
      offNum();
    };
  }, []);

  const current = programme ?? programmes.find((p) => p.start <= now && now < p.end);
  // The first programme that starts once this one is over.
  const next = useMemo(() => {
    const after = current ? current.end : now;
    let best: Programme | undefined;
    for (const p of programmes)
      if (p.start >= after && (!best || p.start < best.start)) best = p;
    return best;
  }, [programmes, current, now]);

  const when = !current ? "Now" : now < current.start ? "Later" : now >= current.end ? "Earlier" : "Now";
  const place = [showNumber && channel.number != null ? `Channel ${channel.number}` : null, folderName]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="hero cl-hero"
      aria-label="Now playing"
      onClick={
        onBackdropClick &&
        ((e) => {
          if (e.target === e.currentTarget) onBackdropClick();
        })
      }
    >
      <div className="cl-pv">
        <div className="hero__preview" id="player-slot" />
      </div>

      <div className="cl-hero__info">
        <h2 className="cl-hero__name">
          <ChannelLogo name={channel.name} logo={channel.logo} size={16} />
          {channel.name}
        </h2>
        {place && <div className="cl-hero__dim">{place}</div>}
        <div className="cl-hero__gap">
          <b>{when}:</b> {current ? current.title : "No Information"}
        </div>
        {current && (
          <div>
            {formatClock(current.start, clockFmt)} – {formatClock(current.end, clockFmt)} (
            {Math.round((current.end.getTime() - current.start.getTime()) / 60_000)} min)
          </div>
        )}
        {current?.synopsis && <div className="cl-hero__dim cl-hero__syn">{current.synopsis}</div>}
        {next && (
          <div className="cl-hero__gap">
            <b>Next:</b> {next.title} at {formatClock(next.start, clockFmt)}
          </div>
        )}
        {onWatch && (
          <div className="cl-hero__btns">
            <button type="button" className="cl-btn cl-btn--def" onClick={onWatch}>
              Watch
            </button>
            {record}
            <button
              type="button"
              className="cl-btn"
              aria-pressed={favorite}
              onClick={onToggleFavorite}
            >
              {favorite ? "Remove from Favorites" : "Add to Favorites"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
