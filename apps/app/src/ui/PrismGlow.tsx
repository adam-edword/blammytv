import { useEffect, useRef, useSyncExternalStore } from "react";
import { prismShowing, subscribeShowing } from "../features/settings/themePack";
import { useCursorGlow } from "./useCursorGlow";

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const reduced = () => window.matchMedia(REDUCED).matches;

/**
 * Prism's cursor light (plan 035): onboarding's glow, brighter, behind the
 * app's content. Drawn only while Prism is showing, and not at all under
 * reduced motion, as onboarding's loop never runs there.
 *
 * MOUNT IT INSIDE `.app-shell`, and nowhere else. The inverted player cuts a
 * clip-path hole through the shell and shows native video beneath the page; a
 * layer outside the shell is not clipped by it and would paint over the video.
 * Inside, behind the shell's content (its z-index is below, in the shell's own
 * stacking context), the hole cuts it with everything else. The dither is the
 * shell's ::before (base.css) for the same reason. packs.css turns the glow off
 * while a hole is cut.
 */
export function PrismGlow() {
  const showing = useSyncExternalStore(subscribeShowing, prismShowing);
  const still = useSyncExternalStore(subscribeReduced, reduced);
  return showing && !still ? <Glow /> : null;
}

function Glow() {
  const ref = useRef<HTMLDivElement>(null);
  const tick = useCursorGlow(ref, true);
  // Runs only while the light is on its way: a still pointer is no frames at
  // all, since the app sits open for hours. Each move starts it again.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      const moving = tick(now, Math.min(0.1, (now - last) / 1000));
      last = now;
      raf = moving ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      cancelAnimationFrame(raf);
    };
  }, [tick]);
  return <div ref={ref} className="prism-glow" aria-hidden />;
}
