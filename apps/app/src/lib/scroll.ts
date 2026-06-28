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

/** Smoothly centre `el` within each scroll container over `ms` (default 250). */
export function smoothCenterIntoView(el: HTMLElement, ms = 250): void {
  const elRect = el.getBoundingClientRect();
  for (const sc of scrollParents(el)) {
    const scRect = sc.getBoundingClientRect();

    let toTop = sc.scrollTop;
    if (sc.scrollHeight > sc.clientHeight) {
      const center = elRect.top - scRect.top + sc.scrollTop + elRect.height / 2;
      toTop = Math.max(
        0,
        Math.min(center - sc.clientHeight / 2, sc.scrollHeight - sc.clientHeight),
      );
    }

    let toLeft = sc.scrollLeft;
    if (sc.scrollWidth > sc.clientWidth) {
      const center = elRect.left - scRect.left + sc.scrollLeft + elRect.width / 2;
      toLeft = Math.max(
        0,
        Math.min(center - sc.clientWidth / 2, sc.scrollWidth - sc.clientWidth),
      );
    }

    animate(sc, toLeft, toTop, ms);
  }
}
