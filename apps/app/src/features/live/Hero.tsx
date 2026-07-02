import { useEffect, useState } from "react";
import { formatClock } from "../../lib/time";
import {
  loadClockFormat,
  onClockFormatChange,
} from "../settings/clockFormat";
import { MOCK_CHANNELS, programmesFor, type MockChannel } from "./mock";

/** The Live tab's hero (Figma 133:479): the mpv preview slot beside the
 * now-playing programme details. Mock-driven until the player lands —
 * the preview keeps a stable element id so the native wiring has a fixed
 * target. */
export function Hero({ channel }: { channel: MockChannel }) {
  // Programme progress creeps, so re-render on a slow tick.
  const [now, setNow] = useState(() => new Date());
  const [clockFmt, setClockFmt] = useState(loadClockFormat);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    const off = onClockFormatChange(setClockFmt);
    return () => {
      window.clearInterval(id);
      off();
    };
  }, []);

  const index = MOCK_CHANNELS.indexOf(channel);
  const current = channel.noInfo
    ? undefined
    : programmesFor(index, now).find((p) => p.start <= now && now < p.end);
  const progress = current
    ? (now.getTime() - current.start.getTime()) /
      (current.end.getTime() - current.start.getTime())
    : 0;

  return (
    <section className="hero" aria-label="Now playing">
      {/* mpv composites into this box later; keep the id stable. */}
      <div className="hero__preview" id="player-slot" />

      <div className="hero__details">
        <span className="hero__live">
          <i className="hero__live-dot" />
          LIVE
        </span>
        <span className="hero__channel">{channel.name}</span>
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
          {current && (
            <span className="hero__time">
              {formatClock(current.start, clockFmt)} –{" "}
              {formatClock(current.end, clockFmt)}
            </span>
          )}
          <div className="hero__bar">
            <div
              className="hero__bar-fill"
              style={{ width: `${(progress * 100).toFixed(2)}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
