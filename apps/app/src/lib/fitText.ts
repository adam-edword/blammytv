import { createRef, useLayoutEffect, useRef } from "react";
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

export function useFitText<T extends HTMLElement>(
  ...texts: string[]
): RefObject<T>[] {
  const refs = useRef<RefObject<T>[] | null>(null);
  refs.current ??= texts.map(() => createRef<T>());
  const els = refs.current;
  // What the effect actually depends on: the strings, not their array.
  const key = texts.join("");

  useLayoutEffect(() => {
    const fit = () => {
      let ratio = 1;
      for (const ref of els) {
        const el = ref.current;
        if (!el) continue;
        // Both numbers are read with the type at full size. The live card's
        // team block is `width: fit-content`, so its box follows the text:
        // measuring the room after a shrink would measure the shrink.
        el.style.fontSize = "";
        const natural = el.scrollWidth;
        const room = el.clientWidth;
        // No layout at all (jsdom, or a card in a hidden tab). Leave the
        // group as the stylesheet has it rather than fitting it to a zero.
        if (natural === 0 || room === 0) return;
        // Both are integers, so an exact fit can read a pixel over.
        if (natural <= room + 1) continue;
        ratio = Math.min(ratio, room / natural);
      }
      if (ratio === 1) return;
      ratio = Math.max(ratio, MIN_RATIO);

      // The stylesheet's size for each line, read once: after the first
      // apply, getComputedStyle would return the size we just wrote.
      const maxes = els.map((ref) =>
        ref.current
          ? Number.parseFloat(getComputedStyle(ref.current).fontSize)
          : 0,
      );
      const apply = (r: number) => {
        els.forEach((ref, i) => {
          if (ref.current) ref.current.style.fontSize = `${(maxes[i] * r).toFixed(2)}px`;
        });
      };
      apply(ratio);

      // Width is only ALMOST linear in size: glyph advances round, so a
      // ratio derived at full size can still land a fraction of a pixel
      // over, and a fraction over is a full ellipsis on screen. Correct
      // against what actually got drawn, which is also why this measures
      // the glyph run rather than the rounded scrollWidth.
      for (let pass = 1; pass < PASSES && ratio > MIN_RATIO; pass++) {
        let worst = 1;
        for (const ref of els) {
          const el = ref.current;
          if (!el) continue;
          const need = runWidth(el);
          const room = el.getBoundingClientRect().width;
          if (need > room + SLACK && need > 0) worst = Math.min(worst, room / need);
        }
        if (worst === 1) break;
        ratio = Math.max(ratio * worst, MIN_RATIO);
        apply(ratio);
      }
    };

    fit();
    // Converges: the callback restores the full size, recomputes the same
    // answer and writes back the same value, so it reports no new size.
    const ro = new ResizeObserver(fit);
    for (const ref of els) if (ref.current) ro.observe(ref.current);
    // Metrics are per face. A measurement taken before the headline font
    // lands is a measurement of the fallback, and themes swap that face.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fit();
    });

    return () => {
      live = false;
      ro.disconnect();
    };
  }, [els, key]);

  return els;
}
