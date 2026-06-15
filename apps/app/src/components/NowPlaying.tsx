import type { LiveChannel, EpgProgram } from "@blammytv/shared";
import { formatTime, isLiveNow, progressPct } from "../lib/epg";
import { Player } from "./Player";

/** The marquee at the top of the Live tab: a preview of the focused channel
 * plus its current program's details. The preview doubles as the player — click
 * it to start the channel's live stream. */
export function NowPlaying({
  channel,
  program,
  now,
  playing,
  theater,
  onPlay,
  onStop,
  onToggleTheater,
  onPopout,
}: {
  channel: LiveChannel;
  program: EpgProgram | null;
  now: number;
  playing: boolean;
  theater: boolean;
  onPlay: () => void;
  onStop: () => void;
  onToggleTheater: () => void;
  onPopout?: () => void;
}) {
  const live = program ? isLiveNow(program, now) : false;

  return (
    <section className="now-playing">
      <div
        className={
          "now-playing__preview" +
          (playing || channel.logo ? "" : " now-playing__preview--empty")
        }
      >
        {playing ? (
          <Player
            url={channel.streamUrl}
            className="now-playing__art"
            theater={theater}
            onToggleTheater={onToggleTheater}
            onPopout={onPopout}
          />
        ) : channel.logo ? (
          <button
            className="now-playing__art now-playing__play-btn"
            type="button"
            aria-label={`Play ${channel.name}`}
            onClick={onPlay}
          >
            <img className="now-playing__art" src={channel.logo} alt="" />
            <span className="now-playing__play now-playing__play--over" />
          </button>
        ) : (
          // Black screen with a play glyph — click to start the stream.
          <button
            className="now-playing__art now-playing__empty now-playing__play-btn"
            type="button"
            aria-label={`Play ${channel.name}`}
            onClick={onPlay}
          >
            <span className="now-playing__play" />
          </button>
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
        {playing && (
          <button className="btn now-playing__stop" type="button" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </section>
  );
}

