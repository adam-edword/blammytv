import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EpgProgram } from "@blammytv/shared";
import {
  ticks,
  minutesFromStart,
  isLiveNow,
  formatTime,
  PX_PER_MIN,
  type GuideWindow,
} from "../lib/epg";
import type { Block, Lane } from "../lib/guide";
import { getChannelPrograms, requestChannelEpg } from "../lib/epgLazy";
import { qualityTags } from "../lib/quality";
import { StarIcon } from "./icons";

/** Once a pinned card's visible width shrinks below this, it stops pinning at
 * the edge and instead slides its left edge under the label (fading) — while
 * its right edge stays anchored to the next card, so the gap never changes. */
const SLIDE_WIDTH = 48;

// Resizable channel-label column (the `--guide-label-w` track), remembered.
const LABEL_MIN = 120;
const LABEL_MAX = 420;
const LABEL_DEFAULT = 200;
const LABEL_STORAGE = "blammytv.guideLabelWidth";

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
  lanes,
  win,
  now,
  selectedProgramId,
  selectedChannelId,
  focusedProgramId,
  focusedChannelId,
  onSelectProgram,
  onSelectChannel,
  onHoverChannel,
  onHoverProgram,
  favoriteIds,
  onToggleFavorite,
}: {
  /** Pre-laid-out channel rows (shared with the live screen's navigation). */
  lanes: Lane[];
  win: GuideWindow;
  now: number;
  selectedProgramId?: string;
  selectedChannelId?: string;
  /** The remote cursor's programme — drawn with a focus ring + scrolled in. */
  focusedProgramId?: string;
  /** The remote cursor's channel when the row has no EPG (the noinfo cell). */
  focusedChannelId?: string;
  onSelectProgram?: (p: EpgProgram) => void;
  /** Selecting an EPG-less ("no info") channel — it still often has a stream. */
  onSelectChannel?: (channelId: string) => void;
  /** Channel ids the user has favorited (lights the star). */
  favoriteIds?: Set<string>;
  onToggleFavorite?: (channelId: string) => void;
  /** Fired with a channel id while a row is hovered, and null on leave, so the
   * hero text can preview that channel without changing playback. */
  onHoverChannel?: (id: string | null) => void;
  /** Fired with the specific programme under the cursor (null over a row but no
   * card), so the hero previews that exact programme — even a future one. */
  onHoverProgram?: (p: EpgProgram | null) => void;
}) {
  // Resizable channel-label column.
  const [labelWidth, setLabelWidth] = useState(() => {
    try {
      const n = parseFloat(localStorage.getItem(LABEL_STORAGE) ?? "");
      return Number.isFinite(n)
        ? Math.min(LABEL_MAX, Math.max(LABEL_MIN, n))
        : LABEL_DEFAULT;
    } catch {
      return LABEL_DEFAULT;
    }
  });
  const [labelResizing, setLabelResizing] = useState(false);
  const labelDrag = useRef({ x: 0, w: 0 });
  useEffect(() => {
    try {
      localStorage.setItem(LABEL_STORAGE, String(labelWidth));
    } catch {
      /* ignore */
    }
  }, [labelWidth]);
  const onLabelResizeDown = (e: React.PointerEvent) => {
    labelDrag.current = { x: e.clientX, w: labelWidth };
    setLabelResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onLabelResizeMove = (e: React.PointerEvent) => {
    if (!labelResizing) return;
    const next = labelDrag.current.w + (e.clientX - labelDrag.current.x);
    setLabelWidth(Math.min(LABEL_MAX, Math.max(LABEL_MIN, next)));
  };
  const onLabelResizeUp = (e: React.PointerEvent) => {
    setLabelResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollXRef = useRef(0);
  const rafRef = useRef(0);

  // Which programme id is pinned per lane. Updated only on a handoff, so the
  // component re-renders rarely; the per-frame motion is applied imperatively.
  const [pins, setPins] = useState<(string | null)[]>([]);

  // Toggle the fade mask on a title/label only when its text actually overflows.
  const clipTitle = (t: HTMLElement) =>
    t.classList.toggle("is-clipped", t.scrollWidth > t.clientWidth + 1);

  // Program titles and channel labels (name + current show) all fade rather
  // than truncate.
  const CLIP_SELECTOR = ".program__title, .guide-row__label-text";

  // Re-measure after a render and once fonts have loaded (their widths shift).
  // Pinned cards are also re-measured per frame in onScroll.
  useLayoutEffect(() => {
    scrollRef.current
      ?.querySelectorAll<HTMLElement>(CLIP_SELECTOR)
      .forEach(clipTitle);
  });
  useEffect(() => {
    let done = false;
    document.fonts?.ready.then(() => {
      if (done) return;
      scrollRef.current
        ?.querySelectorAll<HTMLElement>(CLIP_SELECTOR)
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

  // Keep the remote cursor's cell in view. Pure model math (block geometry +
  // the scroll container's client size), so the body `zoom` never enters — and
  // the single scroll container is moved directly, not via getBoundingClientRect.
  useEffect(() => {
    const c = scrollRef.current;
    if (!c || (!focusedProgramId && !focusedChannelId)) return;

    let row = -1;
    let block: Block | null = null;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      const b = focusedProgramId
        ? lane.blocks.find((x) => x.p.id === focusedProgramId)
        : undefined;
      if (b) {
        row = i;
        block = b;
        break;
      }
      if (focusedChannelId && lane.ch.id === focusedChannelId) {
        row = i;
        break; // noinfo row: spans the lane, no horizontal target
      }
    }
    if (row < 0) return;

    const cs = getComputedStyle(c);
    const labelW = parseFloat(cs.getPropertyValue("--guide-label-w")) || 0;
    const rowH = parseFloat(cs.getPropertyValue("--row-h")) || 60;
    const rulerH =
      c.querySelector<HTMLElement>(".time-ruler")?.offsetHeight ?? 30;
    const M = 16; // horizontal breathing room around the focused cell
    // Keep ~1 row of buffer above/below the focused row, so it scrolls before
    // pinning to the edge (matches the sources rail's scroll-padding).
    const vM = rowH + PROGRAM_GAP;

    // Horizontal: reveal the focused block clear of the sticky label column.
    if (block) {
      const cw = c.clientWidth;
      const minLeft = labelW + block.left + block.width - cw + M;
      const maxLeft = block.left - M;
      let sl = c.scrollLeft;
      if (sl > maxLeft) sl = maxLeft;
      else if (sl < minLeft) sl = minLeft;
      sl = Math.max(0, sl);
      if (Math.abs(sl - c.scrollLeft) > 1) c.scrollLeft = sl;
    } else if (c.scrollLeft !== 0) {
      c.scrollLeft = 0;
    }

    // Vertical: reveal the row clear of the sticky time ruler, plus a row of buffer.
    const y = rulerH + row * (rowH + PROGRAM_GAP);
    const chH = c.clientHeight;
    const minTop = y + rowH - chH + vM;
    const maxTop = y - rulerH - vM;
    let st = c.scrollTop;
    if (st > maxTop) st = maxTop;
    else if (st < minTop) st = minTop;
    st = Math.max(0, st);
    if (Math.abs(st - c.scrollTop) > 1) c.scrollTop = st;
  }, [focusedProgramId, focusedChannelId, lanes, PROGRAM_GAP]);

  // Lazy EPG: request each channel's programmes as its row scrolls into view
  // (with a prefetch margin). Re-observe only when the channel set changes (a
  // category switch) — key={ch.id} keeps the row elements stable across EPG
  // arrivals, so the observer stays valid in between.
  const channelsSig = `${lanes.length}:${lanes[0]?.ch.id ?? ""}:${
    lanes[lanes.length - 1]?.ch.id ?? ""
  }`;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.channelId;
          if (e.isIntersecting && id) requestChannelEpg(id);
        }
      },
      { root, rootMargin: "400px 0px" },
    );
    root
      .querySelectorAll<HTMLElement>("[data-channel-id]")
      .forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [channelsSig]);

  return (
    <div
      className="guide"
      onMouseLeave={() => onHoverChannel?.(null)}
      style={{ "--guide-label-w": `${labelWidth}px` } as React.CSSProperties}
    >
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
              <div
                className="guide-row"
                key={ch.id}
                data-channel-id={ch.id}
                onMouseEnter={() => {
                  onHoverChannel?.(ch.id);
                  onHoverProgram?.(null);
                }}
              >
                <div
                  className={
                    "guide-row__label" +
                    (ch.logo ? " guide-row__label--art" : "")
                  }
                >
                  {ch.logo && (
                    <img className="guide-row__logo" src={ch.logo} alt="" />
                  )}
                  <span className="guide-row__label-meta">
                    <span className="guide-row__label-text">{ch.name}</span>
                    {(() => {
                      const tags = qualityTags(ch.name);
                      return tags.length ? (
                        <span className="guide-row__badges">
                          {tags.map((t) => (
                            <span
                              key={t}
                              className={
                                "quality-badge quality-badge--" +
                                t.toLowerCase()
                              }
                            >
                              {t}
                            </span>
                          ))}
                        </span>
                      ) : null;
                    })()}
                  </span>
                  {onToggleFavorite && (
                    <button
                      type="button"
                      className={
                        "guide-row__fav" +
                        (favoriteIds?.has(ch.id) ? " guide-row__fav--on" : "")
                      }
                      aria-label={
                        favoriteIds?.has(ch.id)
                          ? `Remove ${ch.name} from favorites`
                          : `Add ${ch.name} to favorites`
                      }
                      aria-pressed={favoriteIds?.has(ch.id) ?? false}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(ch.id);
                      }}
                    >
                      <StarIcon size={16} filled={favoriteIds?.has(ch.id)} />
                    </button>
                  )}
                </div>
                <div className="guide-row__lane" style={{ width: laneWidth }}>
                  {blocks.length === 0 ? (
                    // No blocks: either the channel's EPG hasn't been fetched yet
                    // (loading shimmer) or it came back empty ("No Information").
                    // Still selectable either way — these channels often play.
                    <button
                      type="button"
                      className={
                        "program program--noinfo" +
                        (getChannelPrograms(ch.id) === undefined
                          ? " program--loading"
                          : "") +
                        (ch.id === selectedChannelId ? " program--selected" : "") +
                        (ch.id === focusedChannelId ? " program--focused" : "")
                      }
                      style={{
                        left: 0,
                        width: Math.max(0, laneWidth - PROGRAM_GAP),
                      }}
                      aria-label={`Select ${ch.name}`}
                      onClick={() => onSelectChannel?.(ch.id)}
                    >
                      <span className="program__noinfo-text">
                        {getChannelPrograms(ch.id) === undefined
                          ? "loading…"
                          : "No Information"}
                      </span>
                    </button>
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
              hidden behind them when the guide is scrolled. */}
          <div
            className="now-indicator"
            style={{ left: `calc(var(--guide-label-w) + ${nowLeft}px)` }}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Drag the channel-label column wider/narrower. */}
      <div
        className={"guide-resize" + (labelResizing ? " guide-resize--active" : "")}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize channel column"
        onPointerDown={onLabelResizeDown}
        onPointerMove={onLabelResizeMove}
        onPointerUp={onLabelResizeUp}
      />
    </div>
  );

  function cardClass(b: Block, pinned: boolean) {
    return (
      "program" +
      (isLiveNow(b.p, now) ? " program--live" : "") +
      (b.p.id === selectedProgramId ? " program--selected" : "") +
      (b.p.id === focusedProgramId ? " program--focused" : "") +
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
        onMouseEnter={() => onHoverProgram?.(b.p)}
        title={b.p.title}
      >
        {cardBody(b)}
      </button>
    );
  }

  /** Title + airtime range, shared by normal and pinned cards. */
  function cardBody(b: Block) {
    return (
      <span className="program__meta">
        <span className="program__title">{b.p.title}</span>
        <span className="program__time">
          {formatTime(Date.parse(b.p.start))} – {formatTime(Date.parse(b.p.stop))}
        </span>
      </span>
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
        onMouseEnter={() => onHoverProgram?.(b.p)}
        title={b.p.title}
      >
        {cardBody(b)}
      </button>
    );
  }
}
