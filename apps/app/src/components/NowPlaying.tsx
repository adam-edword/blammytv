import type { LiveChannel, EpgProgram } from "@blammytv/shared";
import { formatTime, isLiveNow, progressPct } from "../lib/epg";
import { isTauri, tauriMpvPlay, tauriCompColorTest } from "../lib/tauri";
import { Player, type TheaterMeta } from "./Player";

/** The marquee at the top of the Live tab: a preview of the focused channel
 * plus its current program's details. The preview doubles as the player — click
 * it to start the channel's live stream. */
export function NowPlaying({
  channel,
  program,
  now,
  playing,
  streamUrl,
  sourceName,
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
  /** Source for the player — the channel that's actually streaming. Kept
   * separate from `channel` so hovering a guide row can re-skin the text
   * without disturbing playback. */
  streamUrl: string;
  sourceName?: string;
  theater: boolean;
  onPlay: () => void;
  onStop: () => void;
  onToggleTheater: () => void;
  onPopout?: () => void;
}) {
  const live = program ? isLiveNow(program, now) : false;

  // Content + live position for the theater overlay.
  const meta: TheaterMeta = {
    logo: channel.logo,
    channelName: `${channel.name} HDR`,
    sourceName,
    title: program?.title ?? "No programme information",
    description: program?.description,
    startLabel: program ? formatTime(Date.parse(program.start)) : undefined,
    progressPct: program ? progressPct(program, now) : 100,
    live,
    streamId: channel.id,
    epgId: channel.epgId,
  };

  return (
    <section className="now-playing">
      <div
        className={
          "now-playing__preview" +
          (playing ? "" : " now-playing__preview--empty")
        }
      >
        {playing ? (
          <Player
            url={streamUrl}
            className="now-playing__art"
            theater={theater}
            meta={meta}
            onToggleTheater={onToggleTheater}
            onPopout={onPopout}
            onStop={onStop}
          />
        ) : (
          // Just a black screen with a play glyph — click to start the stream.
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
        {/* TEMP — Tauri Milestone 1: play this channel in mpv via the Rust shell. */}
        {isTauri() && (
          <button
            type="button"
            style={{
              alignSelf: "flex-start",
              margin: "4px 0 8px",
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent, #e11d48)",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
            onClick={() =>
              void tauriMpvPlay(streamUrl).catch((e) =>
                window.alert("mpv_play failed: " + e),
              )
            }
          >
            ▶ Play in mpv (Tauri)
          </button>
        )}
        {/* TEMP — composition spike Step 1: DComp blue layer over the window. */}
        {isTauri() && (
          <button
            type="button"
            style={{
              alignSelf: "flex-start",
              margin: "0 0 8px",
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
            onClick={() =>
              void tauriCompColorTest().catch((e) =>
                window.alert("comp_color_test failed: " + e),
              )
            }
          >
            ▦ DComp color test
          </button>
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

