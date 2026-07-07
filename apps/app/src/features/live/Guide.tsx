import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { load, save } from "../../lib/storage";
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
import {
  GUIDE_HOURS,
  PX_PER_MIN,
  cellRect,
  ticks,
  windowStart,
  xForTime,
} from "./epg";
import type { Channel, Programme } from "./model";

/* Grid geometry (Figma 133:500): 189px channel cards, 8px gutters, 60px
 * rows under the ruler. One scroll container; the ruler and channel column
 * pin via position:sticky, so they can never desync from the cells.
 * The card column is drag-resizable (the old build's `--guide-label-w`
 * mechanics): Figma's 189 is the floor, 2.5x of it the ceiling. */
const CARD_MIN = 189;
const CARD_MAX = Math.round(CARD_MIN * 2.5);
const CARD_W_KEY = "guideCardW";
const CARD_W_VERSION = 1;
const ROW_H = 60;
const ROW_GAP = 8;
const RULER_H = 28;
const CELL_GAP = 8;
/** One row's slice of scroll height (row + its gap). */
const ROW_STEP = ROW_H + ROW_GAP;
/** Extra rows rendered beyond each viewport edge. */
const OVERSCAN = 5;

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

/** Batch form: all reads, then all writes — interleaving them forces a
 * reflow per element, which row-window shifts would pay every 68px. */
function clipTitles(els: Iterable<HTMLElement>) {
  const list = Array.from(els);
  const clipped = list.map((t) => t.scrollWidth > t.clientWidth + 1);
  list.forEach((t, i) => t.classList.toggle("is-clipped", clipped[i]));
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

/** Channel logo with a lettermark fallback: real playlists carry
 * stream_icon URLs of wildly varying health, so a broken image swaps back
 * to the initial. */
function CardLogo({ channel }: { channel: Channel }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="guide__logo" aria-hidden>
      {channel.logo && !broken ? (
        <img
          className="guide__logo-img"
          src={channel.logo}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        channel.name[0]
      )}
    </span>
  );
}

/* memo: hover previews re-render LiveScreen constantly while the cursor
 * crosses cells; the guide's own props stay stable, so it must not be
 * dragged along. */
export const Guide = memo(function Guide({
  channels,
  selectedId,
  favorites,
  onSelect,
  onToggleFavorite,
  onPreview,
}: {
  channels: Array<{ channel: Channel; programmes: Programme[] }>;
  selectedId: string;
  favorites: string[];
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Hover preview for the hero: the exact programme over a cell, the
   * channel's airing programme over a card, null on leave. */
  onPreview: (
    preview: { channel: Channel; programme: Programme | null } | null,
  ) => void;
}) {
  // The now-line creeps and the window jumps at half-hour boundaries.
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

  const start = windowStart(now);
  const laneW = GUIDE_HOURS * 60 * PX_PER_MIN;
  const range = (from: Date, to: Date) =>
    `${formatClock(from, clockFmt)} – ${formatClock(to, clockFmt)}`;

  // Resizable channel-card column, remembered (the old build's mechanics:
  // pointer-capture drag, clamped, persisted).
  const [cardW, setCardW] = useState(() =>
    Math.min(
      CARD_MAX,
      Math.max(CARD_MIN, load<number>(CARD_W_KEY, CARD_W_VERSION, CARD_MIN)),
    ),
  );
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ x: 0, w: 0 });
  useEffect(() => save(CARD_W_KEY, CARD_W_VERSION, cardW), [cardW]);
  /** Left edge of the programme lanes: card column + its 8px gutter. */
  const laneX = cardW + 8;

  const onResizeDown = (e: ReactPointerEvent) => {
    dragRef.current = { x: e.clientX, w: cardW };
    setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent) => {
    if (!resizing) return;
    const next = dragRef.current.w + (e.clientX - dragRef.current.x);
    setCardW(Math.min(CARD_MAX, Math.max(CARD_MIN, next)));
  };
  const onResizeUp = (e: ReactPointerEvent) => {
    setResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollXRef = useRef(0);
  const rafRef = useRef(0);

  /* Vertical row window: real playlists run to six figures of channels, so
   * only the rows near the viewport render (spacer divs keep the scroll
   * height truthful). The window widens by OVERSCAN rows each way and only
   * re-renders when the visible row range actually changes — a 68px step —
   * so horizontal scrubbing (which never changes it) stays render-free. */
  const [rowWin, setRowWin] = useState({ from: 0, to: 36 });
  const renderFrom = Math.max(0, Math.min(rowWin.from, channels.length));
  const renderTo = Math.max(renderFrom, Math.min(rowWin.to, channels.length));

  const measureRowWindow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop - RULER_H;
    const from = Math.max(0, Math.floor(top / ROW_STEP) - OVERSCAN);
    const to = Math.ceil((top + el.clientHeight) / ROW_STEP) + OVERSCAN;
    setRowWin((w) => (w.from === from && w.to === to ? w : { from, to }));
  }, []);

  // Lay the windowed lanes out once; only the pinned cell depends on scroll.
  const lanes = useMemo(
    () =>
      channels.slice(renderFrom, renderTo).map(({ channel, programmes }) => {
        const blocks: Block[] = programmes
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
    [channels, renderFrom, renderTo, now, start],
  );

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
          target.style.left = `${laneX}px`; // sticky constraint, not offset
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
    [computePins, lanes, laneX],
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
    clipTitles(
      scrollRef.current?.querySelectorAll<HTMLElement>(CLIP_SELECTOR) ?? [],
    );
    pinsRef.current = [];
    pinnedElsRef.current = [];
    syncPins(scrollXRef.current);
    // Row-window drift check (channels changed, container resized): a
    // corrected window re-renders once; the equality guard stops the loop.
    measureRowWindow();
  });
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive)
        clipTitles(
          scrollRef.current?.querySelectorAll<HTMLElement>(CLIP_SELECTOR) ??
            [],
        );
    });
    const ro = new ResizeObserver(measureRowWindow);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [measureRowWindow]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const sl = scrollRef.current?.scrollLeft ?? 0;
      scrollXRef.current = sl;
      // Vertical: maybe shift the row window (no-op re-render when it
      // hasn't crossed a row boundary). Horizontal: drive the pins — the
      // lanes/DOM pair from the last render is self-consistent even if a
      // window change is about to land; the post-render effect re-syncs.
      measureRowWindow();
      syncPins(sl);
    });
  }, [measureRowWindow, syncPins]);
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
    /* The wrapper exists for the resize handle: it must overlay the
     * column/lane boundary WITHOUT riding the horizontal pan, so it hangs
     * off a non-scrolling parent. --guide-card-w drives the CSS side
     * (channel column width, handle position). */
    <div
      className="guide-wrap"
      style={{ "--guide-card-w": `${cardW}px` } as CSSProperties}
    >
      {/* The preview clears only when the cursor leaves the guide
       * entirely. Per-row mouseleave cleared it in the gap BETWEEN rows,
       * so a quick vertical sweep flashed the hero back to the selected
       * channel between every pair of cards. */}
      <div
        className="guide"
        ref={scrollRef}
        onScroll={onScroll}
        onMouseLeave={() => onPreview(null)}
      >
      <div className="guide__canvas" style={{ width: laneX + laneW }}>
        <div className="guide__ruler" style={{ height: RULER_H }}>
          {ticks(start).map((t) => (
            <span
              key={t.getTime()}
              className="guide__tick"
              style={{ left: laneX + xForTime(t, start) }}
            >
              | {formatClock(t, clockFmt)}
            </span>
          ))}
          <div className="guide__corner" style={{ width: laneX }} />
        </div>

        {/* Off-window rows exist only as scroll height. */}
        {renderFrom > 0 && <div style={{ height: renderFrom * ROW_STEP }} />}

        {lanes.map(({ channel, blocks }) => {
          const selected = channel.id === selectedId;
          const favorite = favorites.includes(channel.id);
          /* Previews attach to the card and the cells themselves — NOT
           * the row. A row-level enter previewed the channel's airing
           * programme, so sweeping vertically across the lane flashed
           * each channel's live show for a frame before the cell under
           * the cursor fired. Element-to-element handoff has no
           * intermediate state; the gaps between elements just keep the
           * previous preview. */
          return (
            <div
              key={channel.id}
              className="guide__row"
              style={{ height: ROW_H + ROW_GAP }}
            >
              <div
                className={
                  "guide__channel" +
                  (selected ? " guide__channel--selected" : "") +
                  (favorite ? " guide__channel--starred" : "")
                }
                onMouseEnter={() => onPreview({ channel, programme: null })}
              >
                <button
                  type="button"
                  className="guide__card"
                  onClick={() => onSelect(channel.id)}
                >
                  <CardLogo key={channel.logo ?? ""} channel={channel} />
                  <span className="guide__card-meta">
                    <span className="guide__card-name">{channel.name}</span>
                    {channel.quality && (
                      <QualityBadge quality={channel.quality} />
                    )}
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
                  onClick={() => onToggleFavorite(channel.id)}
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
                {blocks.length === 0 ? (
                  <button
                    type="button"
                    className="guide__cell guide__cell--blank"
                    style={{ left: 0, width: laneW - CELL_GAP }}
                    onClick={() => onSelect(channel.id)}
                    onMouseEnter={() =>
                      onPreview({ channel, programme: null })
                    }
                  >
                    <span
                      className="guide__cell-body"
                      style={{ left: laneX + 16 }}
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

        {renderTo < channels.length && (
          <div style={{ height: (channels.length - renderTo) * ROW_STEP }} />
        )}

        <div
          className="guide__nowline"
          style={{ left: laneX + xForTime(now, start), top: RULER_H }}
          aria-hidden
        />
      </div>
      </div>

      {/* Drag the channel-card column wider/narrower. */}
      <div
        className={"guide-resize" + (resizing ? " guide-resize--active" : "")}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize channel column"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
      />
    </div>
  );
});
