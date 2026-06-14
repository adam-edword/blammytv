import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

/** Once a pinned card's visible width shrinks below this, it stops pinning at
 * the edge and instead slides its left edge under the label (fading) — while
 * its right edge stays anchored to the next card, so the gap never changes. */
const SLIDE_WIDTH = 48;

interface Block {
  p: EpgProgram;
  left: number;
  width: number;
}

/** Width / fade / slide for a pinned card at a given horizontal scroll.
 *
 * The card's right edge always sits at `right - scroll` from the edge (so the
 * gap to the next card is constant). While that's wider than SLIDE_WIDTH the
 * card simply shrinks, pinned at the edge. Below it, the card holds SLIDE_WIDTH
 * and translates left by the difference — so the right edge stays put while the
 * left slides under the label — and fades out. */
function pinnedMetrics(right: number, scroll: number) {
  const visible = Math.max(0, right - scroll);
  if (visible >= SLIDE_WIDTH) {
    return { width: visible, opacity: 1, slide: 0 };
  }
  return {
    width: SLIDE_WIDTH,
    opacity: visible / SLIDE_WIDTH,
    slide: -(SLIDE_WIDTH - visible),
  };
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollXRef = useRef(0);
  const rafRef = useRef(0);

  // Which programme id is pinned per lane. Updated only on a handoff, so the
  // component re-renders rarely; the per-frame motion is applied imperatively.
  const [pins, setPins] = useState<(string | null)[]>([]);

  // Toggle the fade mask on a title only when its text actually overflows.
  const clipTitle = (t: HTMLElement) =>
    t.classList.toggle("is-clipped", t.scrollWidth > t.clientWidth + 1);

  // Re-measure every title after a render and once fonts have loaded (their
  // widths shift). Pinned cards are also re-measured per frame in onScroll.
  useLayoutEffect(() => {
    scrollRef.current
      ?.querySelectorAll<HTMLElement>(".program__title")
      .forEach(clipTitle);
  });
  useEffect(() => {
    let done = false;
    document.fonts?.ready.then(() => {
      if (done) return;
      scrollRef.current
        ?.querySelectorAll<HTMLElement>(".program__title")
        .forEach(clipTitle);
    });
    return () => {
      done = true;
    };
  }, []);

  const computePins = useCallback(
    (scroll: number) =>
      lanes.map(
        ({ blocks }) =>
          blocks.find(
            (b) => b.left < scroll && scroll < b.left + b.width - PROGRAM_GAP,
          )?.p.id ?? null,
      ),
    [lanes, PROGRAM_GAP],
  );

  // Reset pins when the data/window changes (e.g. switching category).
  useEffect(() => {
    setPins(computePins(scrollXRef.current));
  }, [computePins]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const sl = scrollRef.current?.scrollLeft ?? 0;
      scrollXRef.current = sl;

      // Re-render only when the pinned programme changes (a handoff).
      const next = computePins(sl);
      setPins((prev) =>
        prev.length === next.length && prev.every((id, i) => id === next[i])
          ? prev
          : next,
      );

      // Drive the pinned cards each frame so they stay locked to the native
      // scroll — no lag against the sticky left edge or the next card. Writes
      // first, then reads (re-measure the fade), to avoid layout thrash.
      const pinnedEls =
        scrollRef.current?.querySelectorAll<HTMLElement>(".program--pinned");
      pinnedEls?.forEach((el) => {
        const right = parseFloat(el.dataset.right || "0");
        const { width, opacity, slide } = pinnedMetrics(right, sl);
        el.style.width = `${width}px`;
        el.style.opacity = `${opacity}`;
        el.style.transform = slide ? `translateX(${slide}px)` : "";
      });
      pinnedEls?.forEach((el) => {
        const t = el.querySelector<HTMLElement>(".program__title");
        if (t) clipTitle(t);
      });
    });
  }, [computePins]);

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
          {lanes.map(({ ch, blocks }, i) => {
            const pinId = pins[i] ?? null;
            const pin = pinId ? blocks.find((b) => b.p.id === pinId) : null;
            return (
              <div className="guide-row" key={ch.id}>
                <div className="guide-row__label">{ch.name}</div>
                <div className="guide-row__lane" style={{ width: laneWidth }}>
                  {blocks.length === 0 ? (
                    // Offline / no programme info from the provider.
                    <div
                      className="program program--noinfo"
                      style={{
                        left: 0,
                        width: Math.max(0, laneWidth - PROGRAM_GAP),
                      }}
                      aria-label="No information"
                    />
                  ) : (
                    blocks.map((b) =>
                      b.p.id === pinId ? null : normalCard(b),
                    )
                  )}
                  {pin && pinnedCard(pin)}
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

  function cardClass(b: Block, pinned: boolean) {
    return (
      "program" +
      (isLiveNow(b.p, now) ? " program--live" : "") +
      (b.p.id === selectedProgramId ? " program--selected" : "") +
      (pinned ? " program--pinned" : "")
    );
  }

  function normalCard(b: Block) {
    return (
      <button
        key={b.p.id}
        type="button"
        className={cardClass(b, false)}
        style={{ left: b.left, width: Math.max(0, b.width - PROGRAM_GAP) }}
        onClick={() => onSelectProgram?.(b.p)}
        title={b.p.title}
      >
        <span className="program__title">{b.p.title}</span>
      </button>
    );
  }

  /** The current block, pinned to the left edge via CSS sticky. Its initial
   * width/fade/slide come from the latest scroll; the per-frame updates are
   * applied imperatively in onScroll (keyed off data-right). */
  function pinnedCard(b: Block) {
    const right = b.left + b.width - PROGRAM_GAP;
    const { width, opacity, slide } = pinnedMetrics(right, scrollXRef.current);
    if (width <= 0) return null;
    return (
      <button
        key={`pin-${b.p.id}`}
        type="button"
        data-right={right}
        className={cardClass(b, true)}
        style={{
          width,
          opacity,
          transform: slide ? `translateX(${slide}px)` : undefined,
        }}
        onClick={() => onSelectProgram?.(b.p)}
        title={b.p.title}
      >
        <span className="program__title">{b.p.title}</span>
      </button>
    );
  }
}

function groupByChannel(programs: EpgProgram[]): Record<string, EpgProgram[]> {
  const out: Record<string, EpgProgram[]> = {};
  for (const p of programs) (out[p.channelId] ??= []).push(p);
  for (const list of Object.values(out))
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}
