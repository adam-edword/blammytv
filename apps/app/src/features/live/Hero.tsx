import { useEffect, useState } from "react";
import { formatClock } from "../../lib/time";
import {
  loadClockFormat,
  onClockFormatChange,
} from "../settings/clockFormat";
import {
  loadShowChannelNumber,
  onShowChannelNumberChange,
} from "../settings/channelNumber";
import { progress as epgProgress } from "./epg";
import type { Channel, Programme } from "./model";
import { ChannelLogo } from "../../ui/ChannelLogo";
import { LivePill } from "../../ui/LivePill";

/** The Live tab's hero (Figma 133:479): the mpv preview slot beside the
 * now-playing programme details. The preview keeps a stable element id so
 * the native player wiring has a fixed target. An explicit `programme`
 * (guide hover preview) overrides the channel's airing one — even a
 * future show. */
export function Hero({
  channel,
  programmes,
  programme,
  onBackdropClick,
}: {
  channel: Channel;
  programmes: Programme[];
  programme?: Programme;
  /** Theater mode: a click on the hero's own black flex-space (not the
   * player box or any child) collapses back to mini. Only the section
   * element itself counts, so nothing inside the picture can trigger it. */
  onBackdropClick?: () => void;
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

  const current =
    programme ?? programmes.find((p) => p.start <= now && now < p.end);
  const live = !!current && current.start <= now && now < current.end;
  const progress = live ? epgProgress(current.start, current.end, now) : 0;

  return (
    <section
      className="hero"
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

      <div className="hero__details">
        {/* The channel as multi-view's tiles say it (plan 019, frame B):
          * its logo on a white tile and its name as an eyebrow, not the
          * accent, which is for live. */}
        <span className="hero__channel">
          <ChannelLogo name={channel.name} logo={channel.logo} size={40} />
          <span className="hero__channel-name">{channel.name}</span>
          {showNumber && channel.number != null && (
            <span className="hero__number">{channel.number}</span>
          )}
        </span>
        <div className="hero__title-wrap">
          <h2 className="hero__title">
            {current ? current.title : "No Information"}
          </h2>
        </div>
        <p className="hero__synopsis">
          {current
            ? current.synopsis
            : "This channel has no programme data right now."}
        </p>
        <div className="hero__meta">
          {/* Only airing programmes wear LIVE: a hover-previewed future
           * show shouldn't claim to be live. */}
          {live && <LivePill />}
          {/* The track sits BETWEEN its two times (plan 019, frame B), so
            * where it starts and where it ends are read off its ends. */}
          {current && (
            <span className="hero__time">{formatClock(current.start, clockFmt)}</span>
          )}
          <div className="hero__bar">
            <div
              className="hero__bar-fill"
              style={{ width: `${(progress * 100).toFixed(2)}%` }}
            />
          </div>
          {current && (
            <span className="hero__time">{formatClock(current.end, clockFmt)}</span>
          )}
        </div>
      </div>
    </section>
  );
}
