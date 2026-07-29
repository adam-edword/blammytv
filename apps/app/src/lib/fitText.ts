import { createRef, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Shrink a line of text until it fits its box.
 *
 * CSS has no shrink-to-fit for text: a line either fits, wraps, or gets cut
 * off, and the size in the stylesheet is the size you get. This measures the
 * line against the room it actually has and steps the size down to match,
 * which is the standard way to do it and the only way that works on text
 * whose length is not known until the data arrives.
 *
 * The elements keep their `text-overflow: ellipsis`: this narrows the cases
 * that reach it, it does not replace it. See MIN_RATIO for why.
 *
 * ONE OBSERVER FOR THE WHOLE PAGE, and one flush for all of it. Each card
 * used to own a ResizeObserver over its own names, so a window drag woke
 * every card in turn and each one did reset, read, write, read, write on
 * its own: a forced relayout per card rather than per board. Measured over
 * five resize steps on a 168 card board, that was 439ms across 1,347 calls;
 * batched into all-resets, then all-reads, then all-writes, the same work
 * is 55ms across 9. The per group arithmetic below is untouched. Only when
 * it runs moved.
 */

/**
 * Never shrink past this share of the stylesheet's size.
 *
 * Measured, at 28px in the 315px upcoming card, each name gets 123px of
 * track: "Brazil" needs 76px and "Manchester City" needs 216px. Fitting
 * every name would put that one at 16px beside a neighbour at 28px, and type
 * that ragged reads as broken rather than as fitted. So the shrink stops
 * here (about 17px) and the ellipsis takes anything past it.
 *
 * The real answer for a fifteen-character club name is a shorter name from
 * the feed, not a smaller font.
 */
const MIN_RATIO = 0.6;

/**
 * How far past its box a line may sit before we call it clipped.
 *
 * Sub-pixel, because that is the scale the problem lives at: the browser
 * draws the ellipsis the moment the run is wider than the box AT ALL, and
 * scrollWidth/clientWidth are integers, so a line 0.7px over reports as
 * fitting exactly. This is the tolerance for "close enough that another
 * pass would only chase rounding".
 */
const SLACK = 0.05;

/** How many corrective passes before we accept what we have. Measured over
 * the five leagues' names, every group settles on the first or second. */
const PASSES = 3;

/**
 * The width of the actual glyph run, sub-pixel.
 *
 * A Range over the contents measures the text rather than the box it is
 * clipped into, which is the only way to see an overflow smaller than a
 * pixel. `scrollWidth` rounds and hides exactly the case that matters.
 */
function runWidth(el: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width;
}

/** One card's worth of lines, sized together. */
type Group = RefObject<HTMLElement>[];

const groups = new Set<Group>();
let pending = 0;

/**
 * Size every group on the page, in phases.
 *
 * The phases are the whole point. Within one phase every group is read, or
 * every group is written, but never one then the other: a write between two
 * reads is what forces the browser to lay the page out again, and doing
 * that per card is what made this expensive.
 */
function flushAll(): void {
  const live = [...groups].filter((g) => g.some((r) => r.current));
  if (!live.length) return;

  // PHASE 1, write. Every line on the page goes back to the stylesheet's
  // size before anything is measured.
  //
  // Splitting the reset from the measure matters wherever a group SHARES a
  // box. In the theater's matchup the two names sit in one flex row and
  // take their width from each other, so resetting one and measuring it
  // while the other is still shrunk reads room that the other line is about
  // to take back. Measured: the first name reported as fitting, the group
  // came out at ratio 1, and the reset left both at full size with the
  // first clipped. On a card each name owns its own column, which is why
  // this went unnoticed.
  for (const g of live)
    for (const r of g) if (r.current) r.current.style.fontSize = "";

  // PHASE 2, read. Natural width against available width, and the
  // stylesheet's size for each line, taken now because after the first
  // apply getComputedStyle would return the size we just wrote.
  const plans: { g: Group; ratio: number; maxes: number[] }[] = [];
  for (const g of live) {
    let ratio = 1;
    let measurable = true;
    for (const r of g) {
      const el = r.current;
      if (!el) continue;
      const natural = el.scrollWidth;
      const room = el.clientWidth;
      // No layout at all (jsdom, or a card in a hidden tab). Leave the
      // group as the stylesheet has it rather than fitting it to a zero.
      if (natural === 0 || room === 0) {
        measurable = false;
        break;
      }
      // Both are integers, so an exact fit can read a pixel over.
      if (natural <= room + 1) continue;
      ratio = Math.min(ratio, room / natural);
    }
    if (!measurable || ratio === 1) continue;
    plans.push({
      g,
      ratio: Math.max(ratio, MIN_RATIO),
      maxes: g.map((r) =>
        r.current ? Number.parseFloat(getComputedStyle(r.current).fontSize) : 0,
      ),
    });
  }
  if (!plans.length) return;

  // PHASE 3, write.
  const apply = (p: (typeof plans)[number]) => {
    p.g.forEach((r, i) => {
      if (r.current)
        r.current.style.fontSize = `${(p.maxes[i] * p.ratio).toFixed(2)}px`;
    });
  };
  for (const p of plans) apply(p);

  // PHASES 4+, read then write, once per pass rather than once per group.
  //
  // Width is only ALMOST linear in size: glyph advances round, so a ratio
  // derived at full size can still land a fraction of a pixel over, and a
  // fraction over is a full ellipsis on screen. Correct against what
  // actually got drawn, which is also why this measures the glyph run
  // rather than the rounded scrollWidth.
  for (let pass = 1; pass < PASSES; pass++) {
    const again: typeof plans = [];
    for (const p of plans) {
      if (p.ratio <= MIN_RATIO) continue;
      let worst = 1;
      for (const r of p.g) {
        const el = r.current;
        if (!el) continue;
        const need = runWidth(el);
        const room = el.getBoundingClientRect().width;
        if (need > room + SLACK && need > 0) worst = Math.min(worst, room / need);
      }
      if (worst === 1) continue;
      p.ratio = Math.max(p.ratio * worst, MIN_RATIO);
      again.push(p);
    }
    if (!again.length) break;
    for (const p of again) apply(p);
  }
}

/** Coalesced to one flush a frame, however many cards asked for it. */
function schedule(): void {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    flushAll();
  });
}

/**
 * One observer for the page.
 *
 * Created lazily so importing this module does nothing in a test
 * environment that has no ResizeObserver.
 */
let observer: ResizeObserver | null = null;
function watcher(): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  // Converges: the flush restores the full size, recomputes the same answer
  // and writes back the same value, so it reports no new size.
  observer ??= new ResizeObserver(schedule);
  return observer;
}

/**
 * Fits a GROUP of lines to one shared size, and returns their refs in order.
 *
 * Shared because the group is peers: the two teams on a card are read
 * against each other, so "Real Madrid" fitted to 17px beside "Bayern" left
 * at 28px looks like a mistake, where both at 17px looks deliberate. The
 * whole group takes the size the tightest member needs.
 *
 * Each element must be the one that clips (`overflow: hidden;
 * white-space: nowrap`), because the fit is read off its own overflow.
 *
 * The texts are dependencies, not values: they are what the elements
 * render, and passing them is what re-measures when the game changes under
 * a recycled card. The count must not change between renders.
 */
export function useFitText<T extends HTMLElement>(
  ...texts: string[]
): RefObject<T>[] {
  const refs = useRef<RefObject<T>[] | null>(null);
  refs.current ??= texts.map(() => createRef<T>());
  const els = refs.current;
  // What the effect actually depends on: the strings, not their array.
  const key = texts.join("");

  useLayoutEffect(() => {
    const group = els as unknown as Group;
    groups.add(group);
    const ro = watcher();
    for (const ref of els) if (ref.current) ro?.observe(ref.current);
    // Synchronously on mount and whenever the text changes, so a card is
    // never painted at the wrong size for a frame. Resizes go through the
    // coalesced path instead.
    flushAll();
    return () => {
      groups.delete(group);
      for (const ref of els) if (ref.current) ro?.unobserve(ref.current);
    };
  }, [els, key]);

  // Metrics are per face. A measurement taken before the headline font
  // lands is a measurement of the fallback, and themes swap that face.
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) schedule();
    });
    return () => {
      live = false;
    };
  }, []);

  return els;
}
