import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RainbowStarIcon,
  StarGhostIcon,
  StarRainbowHollowIcon,
} from "../../ui/icons";
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
 * at the edge and instead slides under the channel column (fading) — while
 * its right edge stays anchored to the next cell, so the gap never changes.
 *
 * Mechanics (v4 = the old build's, refined): the pinned cell switches to
 * position:sticky — its left edge and text ride the COMPOSITOR, so they
 * can't vibrate against the scroll — and its WIDTH is driven per frame so
 * the right edge stays anchored in canvas space. Real width means real
 * corners (the superellipse profile) and truthful text measurement (the
 * fade mask lands on the card edge). The old perf sin wasn't the width
 * write itself — it was React re-rendering per handoff and forced layout
 * reads per frame, both long gone. */
const SLIDE_WIDTH = 48;

/** Width / slide / fade for a pinned sticky cell: shrinks with its right
 * edge anchored; under SLIDE_WIDTH the width holds and it slides beneath
 * the channel column, fading out. */
function pinnedMetrics(b: Block, scroll: number) {
  const visible = b.right - scroll;
  if (visible >= SLIDE_WIDTH) {
    return { width: visible, slide: 0, opacity: 1 };
  }
  return {
    width: SLIDE_WIDTH,
    slide: Math.max(visible - SLIDE_WIDTH, -SLIDE_WIDTH),
    opacity: Math.max(0, visible / SLIDE_WIDTH),
  };
}

/** Fade masks only where text actually overflows (measured, not blind). */
function clipTitle(t: HTMLElement) {
  t.classList.toggle("is-clipped", t.scrollWidth > t.clientWidth + 1);
}

/** Restore a cell to its natural place. The true left comes from the
 * React-rendered data-left attribute — never from imperative bookkeeping,
 * which a re-render can poison (React skips style writes when its props
 * are unchanged, so the pinned 197px would masquerade as the original). */
function unpin(el: HTMLElement) {
  el.classList.remove("guide__cell--pinned");
  if (el.dataset.left) el.style.left = `${el.dataset.left}px`;
  if (el.dataset.width) el.style.width = `${el.dataset.width}px`;
  el.style.clipPath = "";
  el.style.transform = "";
  el.style.opacity = "";
  delete el.dataset.tw;
  // Defensive: older pin mechanics transformed the body, and imperative
  // styles survive both React renders and HMR module swaps.
  const body = el.querySelector<HTMLElement>(".guide__cell-body");
  if (body) body.style.transform = "";
  const t = el.querySelector<HTMLElement>(".guide__cell-title");
  if (t) clipTitle(t);
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

/* memo: hover previews re-render LiveScreen constantly while the cursor
 * crosses cells; the guide's own props stay stable, so it must not be
 * dragged along. */
export const Guide = memo(function Guide({
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

  /* Pinning is fully imperative — React never renders it. With 14+ lanes a
   * handoff happens somewhere almost constantly while scrubbing, and a
   * state-driven pin re-rendered the whole grid each time (the scroll
   * jank). The rAF toggles the class/styles directly; a post-render effect
   * re-applies them since a React render resets className/style. */
  const pinsRef = useRef<(number | null)[]>([]);
  const pinnedElsRef = useRef<(HTMLElement | null)[]>([]);
  const laneElsRef = useRef<HTMLElement[]>([]);

  const computePins = useCallback(
    (scroll: number) =>
      lanes.map(
        ({ blocks }) =>
          blocks.find((b) => b.left < scroll && scroll < b.right)?.key ?? null,
      ),
    [lanes],
  );

  /** Reconcile which cell is pinned per lane, then drive the pinned cells:
   * trailing clip-path (+ slide/fade near the handoff) only — no width
   * writes, no layout. Pinning swaps the cell to position:sticky with the
   * lane edge as its constraint (`left` becomes the sticky offset). Title
   * natural widths are measured once per pin (cached) so the per-frame
   * clip check is pure arithmetic. */
  const syncPins = useCallback(
    (scroll: number) => {
      const next = computePins(scroll);
      const prev = pinsRef.current;
      next.forEach((key, i) => {
        const el = pinnedElsRef.current[i];
        if (prev[i] === key && el?.isConnected) return;
        if (el?.isConnected) unpin(el);
        const target = key
          ? laneElsRef.current[i]?.querySelector<HTMLElement>(
              `[data-key="${key}"]`,
            ) ?? null
          : null;
        pinnedElsRef.current[i] = target;
        if (target) {
          target.style.left = `${LANE_X}px`; // sticky constraint, not offset
          target.classList.add("guide__cell--pinned");
        }
      });
      pinsRef.current = next;

      lanes.forEach(({ blocks }, i) => {
        const key = next[i];
        const el = pinnedElsRef.current[i];
        if (!key || !el) return;
        const b = blocks.find((x) => x.key === key);
        if (!b) return;
        const { width, slide, opacity } = pinnedMetrics(b, scroll);
        el.style.width = `${width}px`;
        el.style.transform = slide ? `translateX(${slide}px)` : "";
        el.style.opacity = opacity < 1 ? `${opacity}` : "";
        const t = el.querySelector<HTMLElement>(".guide__cell-title");
        if (!t) return;
        if (!el.dataset.tw) el.dataset.tw = String(t.scrollWidth);
        // 28 = the cell's horizontal padding.
        t.classList.toggle(
          "is-clipped",
          parseFloat(el.dataset.tw) > width - 28,
        );
      });
    },
    [computePins, lanes],
  );

  const CLIP_SELECTOR = ".guide__cell-title, .guide__card-name";
  useLayoutEffect(() => {
    // After a render: purge every pin artifact FIRST (a render resets only
    // the styles whose props changed, so imperative pin styles linger —
    // across renders AND across HMR module swaps), then refresh lane
    // handles, re-measure fades, and re-pin cleanly.
    scrollRef.current
      ?.querySelectorAll<HTMLElement>(".guide__cell--pinned")
      .forEach(unpin);
    scrollRef.current
      ?.querySelectorAll<HTMLElement>(
        ".guide__cell:not(.guide__cell--blank) .guide__cell-body[style]",
      )
      .forEach((body) => {
        body.style.transform = "";
      });
    laneElsRef.current = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>(".guide__lane") ?? [],
    );
    scrollRef.current
      ?.querySelectorAll<HTMLElement>(CLIP_SELECTOR)
      .forEach(clipTitle);
    pinsRef.current = [];
    pinnedElsRef.current = [];
    syncPins(scrollXRef.current);
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
      syncPins(sl);
    });
  }, [syncPins]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const cellClass = (b: Block) =>
    "guide__cell" + (b.live ? " guide__cell--live" : "");

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

        {lanes.map(({ channel, blocks }) => {
          const selected = channel.id === selectedId;
          const favorite = favorites.includes(channel.id);
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
                  (selected ? " guide__channel--selected" : "") +
                  (favorite ? " guide__channel--starred" : "")
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
                  {favorite ? (
                    <RainbowStarIcon vivid />
                  ) : (
                    <>
                      {/* Card hover shows the ghost; hovering the star
                       * itself swaps to the rainbow-ringed one (CSS). */}
                      <StarGhostIcon className="guide__fav-idle" />
                      <StarRainbowHollowIcon className="guide__fav-hot" />
                    </>
                  )}
                </button>
              </div>

              <div
                className="guide__lane"
                style={{ width: laneW, height: ROW_H }}
              >
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
                  blocks.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      data-key={b.key}
                      data-left={b.left}
                      data-width={b.width}
                      className={cellClass(b)}
                      style={{ left: b.left, width: b.width }}
                      title={b.p.title}
                      onClick={() => onSelect(channel.id)}
                      onMouseEnter={() =>
                        onPreview({ channel, programme: b.p })
                      }
                    >
                      {cellBody(b)}
                    </button>
                  ))
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
});
