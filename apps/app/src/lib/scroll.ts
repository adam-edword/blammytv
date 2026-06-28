// A custom smooth-scroll that centres an element within each of its scroll
// containers over a fixed duration. `scrollIntoView` only offers the browser's
// default-speed "smooth" (too slow) or instant — this gives us an exact, snappy
// duration for D-pad navigation.

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const active = new WeakMap<HTMLElement, number>();

function animate(
  sc: HTMLElement,
  toLeft: number,
  toTop: number,
  ms: number,
): void {
  const fromLeft = sc.scrollLeft;
  const fromTop = sc.scrollTop;
  if (Math.abs(toLeft - fromLeft) < 1 && Math.abs(toTop - fromTop) < 1) return;

  const prev = active.get(sc);
  if (prev) cancelAnimationFrame(prev);

  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const e = easeInOutCubic(t);
    sc.scrollLeft = fromLeft + (toLeft - fromLeft) * e;
    sc.scrollTop = fromTop + (toTop - fromTop) * e;
    if (t < 1) active.set(sc, requestAnimationFrame(step));
    else active.delete(sc);
  };
  active.set(sc, requestAnimationFrame(step));
}

function scrollParents(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node = el.parentElement;
  while (node) {
    const { overflowX, overflowY } = getComputedStyle(node);
    const scrollableY =
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight;
    const scrollableX =
      (overflowX === "auto" || overflowX === "scroll") &&
      node.scrollWidth > node.clientWidth;
    if (scrollableY || scrollableX) out.push(node);
    node = node.parentElement;
  }
  return out;
}

/**
 * Smoothly scroll `el`'s nearest vertical scroll container back to the very top
 * over `ms` (default 250). Used when focus returns to the hero: scrolling to 0
 * lands at the rest position (so the hero keeps its margin gap below the nav),
 * unlike `scrollIntoView({ block: "start" })` which jams the hero under the bar.
 */
export function smoothScrollToTop(el: HTMLElement, ms = 250): void {
  for (const sc of scrollParents(el)) {
    if (sc.scrollHeight > sc.clientHeight) {
      animate(sc, sc.scrollLeft, 0, ms);
      return;
    }
  }
}

/** Smoothly centre `el` within each scroll container. Vertical (row→row) moves
 * use `ms` (default 250); horizontal (card→card within a row) moves use the
 * snappier `horizMs` (default 150) so holding ◀/▶ keeps up instead of lagging
 * behind a long per-card animation.
 *
 * The app applies CSS `zoom` to <body>, which splits coordinate spaces:
 * getBoundingClientRect() reports *visual* (post-zoom) px, while scrollTop /
 * clientHeight report *layout* (pre-zoom) px. So we measure the centring delta
 * entirely from rects (one space) and convert it to scroll units via a zoom
 * ratio self-calibrated from the container (scRect.height / clientHeight). At
 * zoom 1 this reduces to a plain rect-based centre. */
export function smoothCenterIntoView(
  el: HTMLElement,
  ms = 250,
  horizMs = 150,
): void {
  const elRect = el.getBoundingClientRect();
  for (const sc of scrollParents(el)) {
    const scRect = sc.getBoundingClientRect();

    let toTop = sc.scrollTop;
    let movedVertically = false;
    if (sc.scrollHeight > sc.clientHeight) {
      const zoomY = scRect.height / sc.clientHeight || 1;
      const deltaVisual =
        elRect.top + elRect.height / 2 - (scRect.top + scRect.height / 2);
      const want = sc.scrollTop + deltaVisual / zoomY;
      toTop = Math.max(0, Math.min(want, sc.scrollHeight - sc.clientHeight));
      movedVertically = Math.abs(toTop - sc.scrollTop) >= 1;
    }

    let toLeft = sc.scrollLeft;
    if (sc.scrollWidth > sc.clientWidth) {
      const zoomX = scRect.width / sc.clientWidth || 1;
      const deltaVisual =
        elRect.left + elRect.width / 2 - (scRect.left + scRect.width / 2);
      const want = sc.scrollLeft + deltaVisual / zoomX;
      toLeft = Math.max(0, Math.min(want, sc.scrollWidth - sc.clientWidth));
    }

    // The vertical scroller (rows) gets the slower, deliberate easing; the
    // horizontal scroller (cards) gets the snappy one.
    animate(sc, toLeft, toTop, movedVertically ? ms : horizMs);
  }
}
