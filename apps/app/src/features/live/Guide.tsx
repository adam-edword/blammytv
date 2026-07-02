import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RainbowStarIcon, StarIcon } from "../../ui/icons";
import { formatClock } from "../../lib/time";
import {
  loadClockFormat,
  onClockFormatChange,
} from "../settings/clockFormat";
import { QualityBadge } from "../../ui/QualityBadge";
import { loadFavorites, toggleFavorite } from "./favorites";
import {
  GUIDE_HOURS,
  PX_PER_MIN,
  cellRect,
  ticks,
  windowStart,
  xForTime,
} from "./epg";
import { programmesFor, type MockChannel, type Programme } from "./mock";

/* Grid geometry (Figma 133:500): 189px channel cards, 8px gutters, 60px
 * rows under the ruler. One scroll container; the ruler and channel column
 * pin via position:sticky, so they can never desync from the cells. */
const CARD_W = 189;
const LANE_X = CARD_W + 8;
const ROW_H = 60;
const ROW_GAP = 8;
const RULER_H = 28;
const CELL_GAP = 8;

/** Once a pinned cell's visible width shrinks below this, it stops pinning
 * at the edge and instead slides its left edge under the channel column
 * (fading) — while its right edge stays anchored to the next cell, so the
 * gap never changes. (The old build's system, ported intact.) */
const SLIDE_WIDTH = 48;

/** Width / fade / slide for a pinned cell at a given horizontal scroll. */
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

interface Block {
  p: Programme;
  live: boolean;
  /** Lane-relative px; `right` excludes the inter-cell gap. */
  left: number;
  width: number;
  right: number;
  key: number;
}

export function Guide({
  channels,
  selectedId,
  onSelect,
  onPreview,
}: {
  channels: Array<{ channel: MockChannel; index: number }>;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Hover preview for the hero: the exact programme over a cell, the
   * channel's airing programme over a card, null on leave. */
  onPreview: (
    preview: { channel: MockChannel; programme: Programme | null } | null,
  ) => void;
}) {
  // The now-line creeps and the window jumps at half-hour boundaries.
  const [now, setNow] = useState(() => new Date());
  const [clockFmt, setClockFmt] = useState(loadClockFormat);
  const [favorites, setFavorites] = useState(loadFavorites);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    const off = onClockFormatChange(setClockFmt);
    return () => {
      window.clearInterval(id);
      off();
    };
  }, []);

  const start = windowStart(now);
  const laneW = GUIDE_HOURS * 60 * PX_PER_MIN;
  const range = (from: Date, to: Date) =>
    `${formatClock(from, clockFmt)} – ${formatClock(to, clockFmt)}`;

  // Lay each lane out once; only the pinned cell depends on scroll.
  const lanes = useMemo(
    () =>
      channels.map(({ channel, index }) => {
        const blocks: Block[] = channel.noInfo
          ? []
          : programmesFor(index, now)
              .map((p) => ({ p, rect: cellRect(p.start, p.end, start) }))
              .filter((b) => b.rect !== null)
              .map(({ p, rect }) => {
                const width = Math.max(rect!.w - CELL_GAP, 4);
                return {
                  p,
                  live: p.start <= now && now < p.end,
                  left: rect!.x,
                  width,
                  right: rect!.x + width,
                  key: p.start.getTime(),
                };
              });
        return { channel, blocks };
      }),
    [channels, now, start],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollXRef = useRef(0);
  const rafRef = useRef(0);

  // Which programme is pinned per lane. State changes only on a handoff,
  // so renders are rare; the per-frame motion is applied imperatively.
  const [pins, setPins] = useState<(number | null)[]>([]);
  const computePins = useCallback(
    (scroll: number) =>
      lanes.map(
        ({ blocks }) =>
          blocks.find((b) => b.left < scroll && scroll < b.right)?.key ?? null,
      ),
    [lanes],
  );
  useEffect(() => {
    setPins(computePins(scrollXRef.current));
  }, [computePins]);

  // Fade masks only where text actually overflows (measured, not blind).
  const clipTitle = (t: HTMLElement) =>
    t.classList.toggle("is-clipped", t.scrollWidth > t.clientWidth + 1);
  const CLIP_SELECTOR = ".guide__cell-title, .guide__card-name";
  useLayoutEffect(() => {
    scrollRef.current
      ?.querySelectorAll<HTMLElement>(CLIP_SELECTOR)
      .forEach(clipTitle);
  });
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive)
        scrollRef.current
          ?.querySelectorAll<HTMLElement>(CLIP_SELECTOR)
          .forEach(clipTitle);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const sl = scrollRef.current?.scrollLeft ?? 0;
      scrollXRef.current = sl;

      // Re-render only when a pinned programme changes (a handoff).
      const next = computePins(sl);
      setPins((prev) =>
        prev.length === next.length && prev.every((k, i) => k === next[i])
          ? prev
          : next,
      );

      // Drive the pinned cells each frame — writes first, then reads
      // (re-measuring their fades), to avoid layout thrash.
      const pinned = scrollRef.current?.querySelectorAll<HTMLElement>(
        ".guide__cell--pinned",
      );
      pinned?.forEach((el) => {
        const right = parseFloat(el.dataset.right || "0");
        const { width, opacity, slide } = pinnedMetrics(right, sl);
        el.style.width = `${width}px`;
        el.style.opacity = `${opacity}`;
        el.style.transform = slide ? `translateX(${slide}px)` : "";
      });
      pinned?.forEach((el) => {
        const t = el.querySelector<HTMLElement>(".guide__cell-title");
        if (t) clipTitle(t);
      });
    });
  }, [computePins]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const cellClass = (b: Block, pinned: boolean) =>
    "guide__cell" +
    (b.live ? " guide__cell--live" : "") +
    (pinned ? " guide__cell--pinned" : "");

  const cellBody = (b: Block) => (
    <span className="guide__cell-body">
      <span className="guide__cell-title">{b.p.title}</span>
      <span className="guide__cell-time">{range(b.p.start, b.p.end)}</span>
    </span>
  );

  return (
    <div className="guide" ref={scrollRef} onScroll={onScroll}>
      <div className="guide__canvas" style={{ width: LANE_X + laneW }}>
        <div className="guide__ruler" style={{ height: RULER_H }}>
          {ticks(start).map((t) => (
            <span
              key={t.getTime()}
              className="guide__tick"
              style={{ left: LANE_X + xForTime(t, start) }}
            >
              | {formatClock(t, clockFmt)}
            </span>
          ))}
          <div className="guide__corner" style={{ width: LANE_X }} />
        </div>

        {lanes.map(({ channel, blocks }, laneIndex) => {
          const selected = channel.id === selectedId;
          const favorite = favorites.includes(channel.id);
          const pinKey = pins[laneIndex] ?? null;
          const pin = pinKey ? blocks.find((b) => b.key === pinKey) : null;
          const pinMetrics = pin
            ? pinnedMetrics(pin.right, scrollXRef.current)
            : null;
          return (
            <div
              key={channel.id}
              className="guide__row"
              style={{ height: ROW_H + ROW_GAP }}
              onMouseEnter={() => onPreview({ channel, programme: null })}
              onMouseLeave={() => onPreview(null)}
            >
              <div
                className={
                  "guide__channel" +
                  (selected ? " guide__channel--selected" : "")
                }
              >
                <button
                  type="button"
                  className="guide__card"
                  onClick={() => onSelect(channel.id)}
                >
                  <span className="guide__logo" aria-hidden>
                    {channel.name[0]}
                  </span>
                  <span className="guide__card-meta">
                    <span className="guide__card-name">{channel.name}</span>
                    <QualityBadge quality={channel.quality} />
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    "guide__fav" + (favorite ? " guide__fav--on" : "")
                  }
                  aria-label={
                    favorite
                      ? `Remove ${channel.name} from favorites`
                      : `Add ${channel.name} to favorites`
                  }
                  aria-pressed={favorite}
                  onClick={() =>
                    setFavorites((list) => toggleFavorite(list, channel.id))
                  }
                >
                  {favorite ? <RainbowStarIcon /> : <StarIcon />}
                </button>
              </div>

              <div
                className="guide__lane"
                style={{ width: laneW, height: ROW_H }}
              >
                {/* The pinned cell is in-flow (sticky needs that) and comes
                 * first so it can't disturb the absolute cells. Its width/
                 * fade/slide are driven per frame in onScroll. */}
                {pin && pinMetrics && pinMetrics.width > 0 && (
                  <button
                    key={`pin-${pin.key}`}
                    type="button"
                    data-right={pin.right}
                    className={cellClass(pin, true)}
                    style={{
                      left: LANE_X,
                      width: pinMetrics.width,
                      opacity: pinMetrics.opacity,
                      transform: pinMetrics.slide
                        ? `translateX(${pinMetrics.slide}px)`
                        : undefined,
                    }}
                    title={pin.p.title}
                    onClick={() => onSelect(channel.id)}
                    onMouseEnter={() =>
                      onPreview({ channel, programme: pin.p })
                    }
                  >
                    {cellBody(pin)}
                  </button>
                )}

                {channel.noInfo ? (
                  <button
                    type="button"
                    className="guide__cell guide__cell--blank"
                    style={{ left: 0, width: laneW - CELL_GAP }}
                    onClick={() => onSelect(channel.id)}
                  >
                    <span
                      className="guide__cell-body"
                      style={{ left: LANE_X + 16 }}
                    >
                      No Information
                    </span>
                  </button>
                ) : (
                  blocks.map((b) =>
                    b.key === pinKey ? null : (
                      <button
                        key={b.key}
                        type="button"
                        className={cellClass(b, false)}
                        style={{ left: b.left, width: b.width }}
                        title={b.p.title}
                        onClick={() => onSelect(channel.id)}
                        onMouseEnter={() =>
                          onPreview({ channel, programme: b.p })
                        }
                      >
                        {cellBody(b)}
                      </button>
                    ),
                  )
                )}
              </div>
            </div>
          );
        })}

        <div
          className="guide__nowline"
          style={{ left: LANE_X + xForTime(now, start), top: RULER_H }}
          aria-hidden
        />
      </div>
    </div>
  );
}
