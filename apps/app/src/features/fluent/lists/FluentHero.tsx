import { useEffect, useState, type ReactNode } from "react";
import { formatClock } from "../../../lib/time";
import { ChannelLogo } from "../../../ui/ChannelLogo";
import { PlayIcon, StarIcon } from "../../../ui/icons";
import { loadClockFormat, onClockFormatChange } from "../../settings/clockFormat";
import { loadShowChannelNumber, onShowChannelNumberChange } from "../../settings/channelNumber";
import { progress as epgProgress } from "../../live/epg";
import type { Channel, Programme } from "../../live/model";

/**
 * Fluent's preview card: the same `#player-slot` the Hero draws, beside the
 * channel, what is on and what is next, with Watch, Record and a favourite.
 * It keeps the Hero's `hero`, `hero__preview` and `hero__details` classes so
 * theater and fullscreen geometry (live.css) apply unchanged. `actions` is
 * absent for a recording, which has no channel to watch or star.
 */
export function FluentHero({
  channel,
  folderName,
  programmes,
  programme,
  onBackdropClick,
  actions,
}: {
  channel: Channel;
  folderName?: string;
  programmes: Programme[];
  programme?: Programme;
  onBackdropClick?: () => void;
  actions?: {
    favorite: boolean;
    onWatch: () => void;
    onToggleFavorite: () => void;
    record: ReactNode;
  };
}) {
  // Programme progress creeps, so re-render on a slow tick.
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
  const live = !!current && current.start <= now && now < current.end;
  const progress = live ? epgProgress(current.start, current.end, now) : 0;
  const next = current
    ? programmes
        .filter((p) => p.start >= current.end)
        .reduce<Programme | undefined>((a, p) => (!a || p.start < a.start ? p : a), undefined)
    : undefined;
  const label = !current ? "" : live ? "Now:" : current.end <= now ? "Earlier:" : "Later:";
  const where = [showNumber && channel.number != null ? `Channel ${channel.number}` : null, folderName]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="hero fl-hero"
      aria-label="Now playing"
      onClick={
        onBackdropClick &&
        ((e) => {
          if (e.target === e.currentTarget) onBackdropClick();
        })
      }
    >
      {/* mpv composites into this box later; keep the id stable. */}
      <div className="hero__preview" id="player-slot" />

      <div className="hero__details fl-hero__details">
        <div className="fl-hero__who">
          <ChannelLogo name={channel.name} logo={channel.logo} size={28} className="fl-hero__logo" />
          <h2 className="fl-hero__name">{channel.name}</h2>
        </div>
        {where && <p className="fl-hero__where">{where}</p>}
        <p className="fl-hero__now">
          {current ? (
            <>
              <strong>{label}</strong> {current.title} · {formatClock(current.start, clockFmt)} to{" "}
              {formatClock(current.end, clockFmt)}
            </>
          ) : (
            "No Information"
          )}
        </p>
        {current?.synopsis && <p className="fl-hero__synopsis">{current.synopsis}</p>}
        {live && (
          <div
            className="fl-progress"
            role="progressbar"
            aria-label="Programme progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="fl-progress__fill" style={{ width: `${(progress * 100).toFixed(2)}%` }} />
          </div>
        )}
        {next && (
          <p className="fl-hero__next">
            <strong>Next:</strong> {next.title} at {formatClock(next.start, clockFmt)}
          </p>
        )}
        {actions && (
          <div className="fl-hero__actions">
            <button type="button" className="fl-btn fl-btn--accent" onClick={actions.onWatch}>
              <PlayIcon size={14} />
              Watch
            </button>
            {actions.record}
            <button
              type="button"
              className="fl-btn fl-btn--icon"
              aria-label={actions.favorite ? `Remove ${channel.name} from favorites` : `Add ${channel.name} to favorites`}
              aria-pressed={actions.favorite}
              onClick={actions.onToggleFavorite}
            >
              <StarIcon size={15} filled={actions.favorite} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
