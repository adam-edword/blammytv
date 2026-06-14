import type { LiveChannel, EpgProgram } from "@blammytv/shared";
import { formatTime, isLiveNow, progressPct } from "../lib/epg";

/** The marquee at the top of the Live tab: a preview of the focused channel
 * plus its current program's details. */
export function NowPlaying({
  channel,
  program,
  now,
}: {
  channel: LiveChannel;
  program: EpgProgram | null;
  now: number;
}) {
  const live = program ? isLiveNow(program, now) : false;

  return (
    <section className="now-playing">
      <div
        className={
          "now-playing__preview" +
          (channel.logo ? "" : " now-playing__preview--empty")
        }
      >
        {channel.logo ? (
          <img className="now-playing__art" src={channel.logo} alt="" />
        ) : (
          // Nothing actually playing yet — a basic black screen with a play
          // glyph stands in for the player surface.
          <div className="now-playing__art now-playing__empty" aria-hidden="true">
            <span className="now-playing__play" />
          </div>
        )}
      </div>

      <div className="now-playing__details">
        {live && (
          <span className="live-badge">
            <span className="live-badge__dot" aria-hidden="true" />
            LIVE
          </span>
        )}
        <p className="now-playing__channel">{channel.name} HDR</p>
        <h1 className="now-playing__title">
          {program?.title ?? "No programme information"}
        </h1>
        {program?.description && (
          <p className="now-playing__desc">{program.description}</p>
        )}
        {program && (
          <div className="now-playing__progress-row">
            <span className="now-playing__times">
              {formatTime(Date.parse(program.start))} –{" "}
              {formatTime(Date.parse(program.stop))}
            </span>
            <div className="progress" aria-hidden="true">
              <div
                className="progress__fill"
                style={{ width: `${progressPct(program, now)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
