import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * A soft light that trails the pointer: the lerp onboarding's cursor glow has
 * always used (Onboarding.tsx), pulled out so Prism's glow (PrismGlow.tsx)
 * moves the same way.
 *
 * Returns a tick for the caller's clock: `tick(now, dt)` with dt in seconds.
 * The element stays hidden until the pointer first moves; then the tick adds
 * `is-live` (the stylesheet fades it in) and jumps it to the pointer, so it
 * never sweeps in from the corner. After that it eases toward the pointer,
 * `dt * 9` of the distance a frame, capped at all of it.
 *
 * `mouseOnly` ignores touch and pen: a finger has no hover to light.
 *
 * The tick answers whether the light is still on its way, so a caller can
 * stop its clock once it has arrived.
 */
export function useCursorGlow(ref: RefObject<HTMLElement | null>, mouseOnly = false) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pos = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (mouseOnly && e.pointerType !== "mouse") return;
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [mouseOnly]);
  return useCallback(
    (_now: number, dt: number) => {
      const target = pointer.current;
      const el = ref.current;
      if (!target || !el) return false;
      let p = pos.current;
      if (!p) {
        p = { ...target };
        pos.current = p;
        el.classList.add("is-live");
      } else {
        p.x += (target.x - p.x) * Math.min(1, dt * 9);
        p.y += (target.y - p.y) * Math.min(1, dt * 9);
      }
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      return Math.abs(target.x - p.x) > 0.1 || Math.abs(target.y - p.y) > 0.1;
    },
    [ref],
  );
}
