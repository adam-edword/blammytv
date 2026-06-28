// A custom smooth-scroll that centres an element within each of its scroll
// containers over a fixed duration. `scrollIntoView` only offers the browser's
// default-speed "smooth" (too slow) or instant — this gives us an exact, snappy
// duration for D-pad navigation.

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- TEMP DIAGNOSTIC (remove once centring is fixed) -----------------------
// Flip to false to silence. Renders the last vertical-centring computation in a
// fixed overlay so we can read the real numbers off a screenshot on the
// emulator (no chrome://inspect needed).
const DEBUG_SCROLL = true;
let dbgEl: HTMLElement | null = null;
let dbgCompute = "";
let dbgResult = "";
function dbgRender(): void {
  if (!dbgEl) {
    dbgEl = document.createElement("pre");
    dbgEl.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:99999;margin:0;padding:8px 10px;" +
      "background:rgba(0,0,0,0.8);color:#0f0;font:11px/1.4 monospace;" +
      "white-space:pre;pointer-events:none;border-radius:6px;max-width:60vw";
    document.body.appendChild(dbgEl);
  }
  dbgEl.textContent = dbgCompute + (dbgResult ? "\n" + dbgResult : "");
}
function dbg(line: string): void {
  if (!DEBUG_SCROLL) return;
  dbgCompute = line;
  dbgResult = "";
  dbgRender();
}
function dbgReport(line: string): void {
  if (!DEBUG_SCROLL) return;
  dbgResult = line;
  dbgRender();
}
// ---------------------------------------------------------------------------

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

  const vertical = Math.abs(toTop - fromTop) >= 1;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const e = easeInOutCubic(t);
    sc.scrollLeft = fromLeft + (toLeft - fromLeft) * e;
    sc.scrollTop = fromTop + (toTop - fromTop) * e;
    if (t < 1) active.set(sc, requestAnimationFrame(step));
    else {
      active.delete(sc);
      if (vertical) {
        const ended = sc.scrollTop;
        dbgReport(`ended=${ended.toFixed(0)} (target ${toTop.toFixed(0)})`);
        window.setTimeout(() => {
          dbgReport(
            `ended=${ended.toFixed(0)} settled=${sc.scrollTop.toFixed(0)} (target ${toTop.toFixed(0)})`,
          );
        }, 350);
      }
    }
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
      const want = center - sc.clientHeight / 2;
      toTop = Math.max(
        0,
        Math.min(want, sc.scrollHeight - sc.clientHeight),
      );
      dbg(
        `sc=${sc.className.split(" ")[0]}\n` +
          `elTop=${elRect.top.toFixed(0)} elH=${elRect.height.toFixed(0)}\n` +
          `scTop=${scRect.top.toFixed(0)} clientH=${sc.clientHeight} scrollH=${sc.scrollHeight}\n` +
          `from=${sc.scrollTop.toFixed(0)} want=${want.toFixed(0)} toTop=${toTop.toFixed(0)}` +
          (want > sc.scrollHeight - sc.clientHeight ? " [CLAMPED@end]" : "") +
          (want < 0 ? " [CLAMPED@top]" : ""),
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
