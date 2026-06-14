import { useMemo } from "react";
import type { LiveChannel, EpgProgram } from "@blammytv/shared";
import {
  guideWindow,
  ticks,
  blockGeometry,
  minutesFromStart,
  isLiveNow,
  formatTime,
  PX_PER_MIN,
  type GuideWindow,
} from "../lib/epg";

/** The time-grid TV guide. Channels down the side, programmes laid out along a
 * shared time axis, with a live "now" indicator. */
export function EpgGuide({
  channels,
  programs,
  now,
  selectedProgramId,
  onSelectProgram,
}: {
  channels: LiveChannel[];
  programs: EpgProgram[];
  now: number;
  selectedProgramId?: string;
  onSelectProgram?: (p: EpgProgram) => void;
}) {
  const win = useMemo<GuideWindow>(() => guideWindow(now), [now]);
  const laneWidth = minutesFromStart(win, win.end) * PX_PER_MIN;
  const byChannel = useMemo(() => groupByChannel(programs), [programs]);
  const nowLeft = minutesFromStart(win, now) * PX_PER_MIN;

  return (
    <div className="guide">
      <div className="guide__scroll">
        <div className="guide__inner">
          {/* Time ruler */}
          <div className="time-ruler">
            <div className="time-ruler__spacer" />
            <div className="time-ruler__track" style={{ width: laneWidth }}>
              {ticks(win).map((t) => (
                <span
                  key={t}
                  className="time-ruler__tick"
                  style={{ left: minutesFromStart(win, t) * PX_PER_MIN }}
                >
                  | {formatTime(t)}
                </span>
              ))}
            </div>
          </div>

          {/* Channel rows */}
          {channels.map((ch) => {
            const blocks = (byChannel[ch.id] ?? [])
              .map((p) => ({ p, ...blockGeometry(win, p) }))
              .filter((b) => b.width > 0);
            return (
              <div className="guide-row" key={ch.id}>
                <div className="guide-row__label">{ch.name}</div>
                <div className="guide-row__lane" style={{ width: laneWidth }}>
                  {blocks.length === 0 ? (
                    // Offline / no programme info from the provider. The
                    // hatched styling conveys it; label is for screen readers.
                    <div
                      className="program program--noinfo"
                      style={{ left: 0, width: Math.max(0, laneWidth - 6) }}
                      aria-label="No information"
                    />
                  ) : (
                    blocks.map(({ p, left, width }) => {
                      const live = isLiveNow(p, now);
                      const selected = p.id === selectedProgramId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={
                            "program" +
                            (live ? " program--live" : "") +
                            (selected ? " program--selected" : "")
                          }
                          style={{ left, width: Math.max(0, width - 6) }}
                          onClick={() => onSelectProgram?.(p)}
                          title={p.title}
                        >
                          <span className="program__title">{p.title}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}

          {/* Now indicator: the line sits below the sticky labels so it's
              hidden behind them when scrolled; the dot is a separate element
              above the time ruler so it isn't clipped. */}
          <div
            className="now-indicator"
            style={{ left: `calc(var(--guide-label-w) + ${nowLeft}px)` }}
            aria-hidden="true"
          />
          <div
            className="now-dot"
            style={{ left: `calc(var(--guide-label-w) + ${nowLeft}px)` }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

function groupByChannel(programs: EpgProgram[]): Record<string, EpgProgram[]> {
  const out: Record<string, EpgProgram[]> = {};
  for (const p of programs) (out[p.channelId] ??= []).push(p);
  for (const list of Object.values(out))
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}
