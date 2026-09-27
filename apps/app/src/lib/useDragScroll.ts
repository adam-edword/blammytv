import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

/**
 * Click-and-drag scrolling for a sideways row: pointer deltas map 1:1 onto
 * scrollLeft (no physics, native feel only). Past a small slop the gesture
 * is a DRAG: capture the pointer and swallow the next click so the card
 * under the cursor doesn't open. A mouse only; touch scrolls natively.
 *
 * RowScroller's (Stream home, Continue Watching, Discover's genre rail),
 * shared since v0.10.18 so multi-view's Live Scores row drags the same way
 * (Adam: "add click/drag to the score bar on multiview").
 *
 * Spread what it returns on the scroller. Mid-drag the scroller takes
 * `.is-dragging`, and its own sheet gives that the grabbing cursor and
 * turns the pointer off its children.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>) {
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  // Set when a drag ends; the gesture's trailing click (which fires AFTER
  // pointerup) checks-and-clears it in the capture phase, before any
  // card's own onClick can open something.
  const justDragged = useRef(false);
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType !== "mouse") return; // touch scrolls natively
    const el = ref.current;
    if (!el) return;
    justDragged.current = false;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
  };
  /** Drop a gesture whose end we never saw. Deliberately does NOT arm the
   * click latch: there is no trailing click to swallow. */
  const abandonDrag = useCallback(() => {
    drag.current = null;
    ref.current?.classList.remove("is-dragging");
  }, [ref]);
  // Losing the window mid-drag is the common way an up event goes missing,
  // and `lostpointercapture` covers the OS releasing capture on its own.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    window.addEventListener("blur", abandonDrag);
    el.addEventListener("lostpointercapture", abandonDrag);
    return () => {
      window.removeEventListener("blur", abandonDrag);
      el.removeEventListener("lostpointercapture", abandonDrag);
    };
  }, [ref, abandonDrag]);
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    // This fires on plain HOVER too, not only mid-drag. If the terminating
    // pointerup never arrived (alt-tab away with the button down, and the
    // OS can drop pointer capture without one), `drag` stays armed, and
    // the next hover starts a phantom drag whose .is-dragging sets
    // pointer-events:none on the whole row. Hover then looks broken until
    // some later drag happens to end cleanly. No buttons down means the
    // gesture is over, whatever events did or did not arrive.
    if (e.buttons === 0) return abandonDrag();
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return; // click slop
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("is-dragging");
    }
    el.scrollLeft = d.left - dx;
  };
  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d?.moved || !el) return;
    justDragged.current = true;
    // Self-heal: if the trailing click never arrives (capture-release
    // edge cases), don't leave the latch armed to eat a later real click.
    window.setTimeout(() => {
      justDragged.current = false;
    }, 250);
    el.releasePointerCapture(e.pointerId);
    el.classList.remove("is-dragging");
  };
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (!justDragged.current) return;
    justDragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onClickCapture,
  };
}
