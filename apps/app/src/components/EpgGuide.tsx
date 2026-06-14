import { useCallback, useMemo, useRef, useState } from "react";
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

/** Only once a pinned card shrinks below this width — about when it would
 * otherwise be a thin sliver hovering over the next card — does it fade out, so
 * it dissolves gracefully instead of leaving a sliver/empty box. */
const FADE_WIDTH = 48;

/** How far (px) the card drifts left under the label as it fades, so it reads
 * as sliding off the edge rather than dissolving in place. */
const SLIDE_DISTANCE = 28;

interface Block {
  p: EpgProgram;
  left: number;
  width: number;
}

/** The time-grid TV guide. Channels down the side, programmes laid out along a
 * shared time axis, with a live "now" indicator. The programme currently at the
 * left edge is "pinned" there as a rounded card while it airs. */
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
  const nowLeft = minutesFromStart(win, now) * PX_PER_MIN;

  // Gap between adjacent program cards — shares the --label-card-gap token so
  // the horizontal card gap matches the row gap and label gutter.
  const PROGRAM_GAP = useMemo(
    () =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--label-card-gap",
        ),
      ) || 12,
    [],
  );

  // Lay out each channel's blocks once; only the pinned card depends on scroll.
  const lanes = useMemo(() => {
    const byChannel = groupByChannel(programs);
    return channels.map((ch) => ({
      ch,
      blocks: (byChannel[ch.id] ?? [])
        .map((p) => ({ p, ...blockGeometry(win, p) }))
        .filter((b) => b.width > 0)
        .sort((a, b) => a.left - b.left),
    }));
  }, [channels, programs, win]);

  // Track horizontal scroll (rAF-throttled) to drive the pinned cards.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollLeft(scrollRef.current?.scrollLeft ?? 0);
    });
  }, []);

  return (
    <div className="guide">
      <div className="guide__scroll" ref={scrollRef} onScroll={onScroll}>
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
          {lanes.map(({ ch, blocks }) => {
            // The block spanning the left edge that has also scrolled past it.
            const pinned =
              blocks.find(
                (b) => b.left < scrollLeft && scrollLeft < b.left + b.width,
              ) ?? null;
            return (
              <div className="guide-row" key={ch.id}>
                <div className="guide-row__label">{ch.name}</div>
                <div className="guide-row__lane" style={{ width: laneWidth }}>
                  {blocks.length === 0 ? (
                    // Offline / no programme info from the provider.
                    <div
                      className="program program--noinfo"
                      style={{ left: 0, width: Math.max(0, laneWidth - PROGRAM_GAP) }}
                      aria-label="No information"
                    />
                  ) : (
                    // Skip the normal copy of the pinned block — the pinned card
                    // covers its visible extent, and live blocks are translucent
                    // so a copy underneath would show through.
                    blocks.map((b) =>
                      b === pinned ? null : programButton(b, false),
                    )
                  )}
                  {pinned && pinnedCard(pinned, scrollLeft)}
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

  function programButton(b: Block, pinned: boolean, opacity = 1, slide = 0) {
    const live = isLiveNow(b.p, now);
    const selected = b.p.id === selectedProgramId;
    return (
      <button
        key={pinned ? `pin-${b.p.id}` : b.p.id}
        type="button"
        className={
          "program" +
          (live ? " program--live" : "") +
          (selected ? " program--selected" : "") +
          (pinned ? " program--pinned" : "")
        }
        // Pinned cards are positioned at the edge with CSS sticky (left edge is
        // composited by the browser — no scroll-lag wiggle); only the width is
        // JS-driven, so the right edge tracks the programme's end.
        style={
          pinned
            ? {
                width: b.width,
                opacity,
                transform: slide ? `translateX(${slide}px)` : undefined,
              }
            : { left: b.left, width: Math.max(0, b.width - PROGRAM_GAP) }
        }
        onClick={() => onSelectProgram?.(b.p)}
        title={b.p.title}
      >
        <span className="program__title">{b.p.title}</span>
      </button>
    );
  }

  /** A copy of the current block pinned to the left edge (via CSS sticky),
   * shrinking toward its end time as the guide scrolls. Over its final stretch
   * it fades out and drifts left under the label, so it slides off the edge. */
  function pinnedCard(b: Block, scroll: number) {
    const right = b.left + b.width - PROGRAM_GAP;
    const width = right - scroll;
    if (width <= 0) return null;
    const opacity = Math.min(1, width / FADE_WIDTH);
    const slide = -(1 - opacity) * SLIDE_DISTANCE;
    return programButton({ p: b.p, left: 0, width }, true, opacity, slide);
  }
}

function groupByChannel(programs: EpgProgram[]): Record<string, EpgProgram[]> {
  const out: Record<string, EpgProgram[]> = {};
  for (const p of programs) (out[p.channelId] ??= []).push(p);
  for (const list of Object.values(out))
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}
