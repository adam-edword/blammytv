// A custom smooth-scroll that centres an element within each of its scroll
// containers over a fixed duration. `scrollIntoView` only offers the browser's
// default-speed "smooth" (too slow) or instant — this gives us an exact, snappy
// duration for D-pad navigation.

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
    const e = easeOutCubic(t);
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
