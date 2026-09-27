import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { ChevronIcon } from "./icons";
import { useDragScroll } from "../lib/useDragScroll";

// Moved here from features/stream/StreamScreen.tsx in v0.10.31 (ROADMAP M2,
// plan 014 L2), unchanged. Stream, Discover, Library and Sports all draw
// their rows with it, and a primitive living in one screen's file is why
// redoing that screen kept touching the other three.

/** Horizontal row shell: scroller + edge scrims + hover arrows. Scrims
 * and arrows only exist on a side that actually has hidden content
 * (scroll position tracked; ResizeObserver keeps it honest). Arrows
 * nudge by ~75% of the viewport, smooth. */
export function RowScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * ONE TAB STOP PER ROW, arrows to move inside it.
   *
   * A row is a list you scan, not forty separate destinations. Measured on
   * the sports board, crossing Today's row cost 42 presses and ArrowRight
   * did nothing at all — and Stream home and Discover's genre rail are the
   * same component with the same problem.
   *
   * Roving tabindex, the pattern ModeRail and the hero carousel already
   * use: every item but the current one leaves the tab order, and the
   * arrows move focus and selection together. Done imperatively rather
   * than by prop, because the children here are four different kinds of
   * card from three different features and none of them need to know.
   */
  const items = () =>
    ref.current
      ? [...ref.current.querySelectorAll<HTMLElement>(":scope > *")].filter(
          (el) => el.matches("button, a, [tabindex]") && !el.hasAttribute("disabled"),
        )
      : [];
  const rove = useCallback(() => {
    const all = items();
    if (!all.length) return;
    // Whatever already has focus keeps it; otherwise the first item is the
    // way in. A disabled-only row leaves nothing tabbable, which is right.
    const active = all.findIndex((el) => el.tabIndex === 0);
    const keep = active === -1 ? 0 : active;
    all.forEach((el, i) => {
      el.tabIndex = i === keep ? 0 : -1;
    });
  }, []);
  useEffect(rove);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    let next: number;
    if (e.key === "ArrowRight") next = Math.min(at + 1, all.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(at - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = all.length - 1;
    else return;
    e.preventDefault();
    all.forEach((el, i) => {
      el.tabIndex = i === next ? 0 : -1;
    });
    all[next]?.focus();
    // Keep the focused card on screen. Arrow keys are how a keyboard reads
    // this row, so the row has to follow.
    all[next]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  const [can, setCan] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCan({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);
  const nudge = (dir: 1 | -1) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.75,
      // Chromium does NOT auto-disable programmatic smooth scroll under
      // reduced motion — branch it (the app's inline matchMedia idiom).
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  // Click-and-drag scrolling (lib/useDragScroll). Serves every row: Stream
  // home, Continue Watching, and Discover's genre rail all render through
  // here.
  const dragScroll = useDragScroll(ref);
  return (
    <div className="media-row__viewport">
      <div
        className="media-row__scroller"
        ref={ref}
        onKeyDown={onKeyDown}
        {...dragScroll}
      >
        {children}
      </div>
      {can.left && (
        <Button variant="secondary" size="icon"
          type="button"
          // The capsule's glass behind the glyph (plan 019, K3): it sits over
          // artwork and card text, and a bare chevron over a team name read
          // as part of the name.
          className="media-row__arrow media-row__arrow--left"
          aria-label="Scroll back"
          onClick={() => nudge(-1)}
        >
          <ChevronIcon className="size-4.5" />
        </Button>
      )}
      {can.right && (
        <Button variant="secondary" size="icon"
          type="button"
          // The capsule's glass behind the glyph (plan 019, K3): it sits over
          // artwork and card text, and a bare chevron over a team name read
          // as part of the name.
          className="media-row__arrow media-row__arrow--right"
          aria-label="Scroll forward"
          onClick={() => nudge(1)}
        >
          <ChevronIcon className="size-4.5" />
        </Button>
      )}
    </div>
  );
}
