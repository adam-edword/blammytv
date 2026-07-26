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
 * Measured, at 28px in the 265px upcoming card, each name gets 97px of
 * track: "Brazil" needs 76px and "Manchester City" needs 216px. Fitting
 * every name would put that one at 13px beside a neighbour at 28px, and type
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
      for (const ref of els) {
        const el = ref.current;
        if (!el) continue;
        // Width is close enough to linear in size for one pass: a second
        // would move it by a fraction of a pixel.
        const max = Number.parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = `${(max * ratio).toFixed(2)}px`;
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
