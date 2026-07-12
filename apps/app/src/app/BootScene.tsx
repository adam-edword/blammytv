import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

/**
 * The ONE-PIECE boot scene (Adam's Figma spec, node 272:1000): the
 * brand conic on an oversized rotating sheet, a blur-softened black
 * screen, and the wordmark — persistent from mount to the host's
 * release. Onboarding renders it under the steps (the backdrop IS
 * frame zero of the boot timeline); WelcomeAnimation renders it for
 * cold boots. One component, one stylesheet (boot.css), no twins.
 *
 * This component owns the single rAF clock:
 * - idle: velocity-model rotation (slow drift, "thinking" bursts on
 *   advances — hosts call think/thinkHard/thinkDone);
 * - beginFinale(): a quintic-Hermite unwind from the live angle AND
 *   velocity (no kink at entry, even mid-burst) to the next full turn
 *   ≥540° ahead — landing EXACTLY on rotation 0, where the static
 *   paint sits at the boot's native angle. The loop itself flips the
 *   phase classes the same frame the landing completes (no timer
 *   race), inserts one full tick between filter teardown (is-landed)
 *   and the first geometry motion (is-shrink), finishes the scaleY
 *   settle, writes the final transform, and exits. Blur, opacity and
 *   the shrink run from boot.css per phase class.
 * Reduced motion: the loop never runs; hosts never call beginFinale.
 */

const BASE_DEG_S = 16;
const BURST_DEG_S = 320;
const BURST_MS = 700;
/** P1 length: the unwind + unblur. */
export const LAND_MS = 830;
/** scaleY 1.15→1 settles here (mock track runs past the landing). */
export const SETTLE_MS = 1490;
/** Full mock timeline (hosts time their release from this). */
export const BOOT_TIMELINE_MS = 2530;
/** Extra forward travel guaranteed by the unwind (~1.5 turns). */
const UNWIND_MIN_DEG = 540;

export type BootSceneHandle = {
  think(): void;
  thinkHard(): void;
  thinkDone(): void;
  /** Start the one-piece finale. Idempotent. */
  beginFinale(): void;
};

type Phase = "idle" | "landing" | "landed" | "shrink";

export const BootScene = forwardRef<
  BootSceneHandle,
  {
    /** Extra per-frame work on the same clock (Onboarding's
     * cursor-glow lerp rides here — one loop, ever). */
    onTick?: (now: number, dt: number) => void;
  }
>(function BootScene({ onTick }, ref) {
  const [phase, setPhase] = useState<Phase>("idle");
  const sheetRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const velRef = useRef(BASE_DEG_S);
  const burstUntil = useRef(0);
  /** Set by beginFinale: the Hermite tween's parameters. */
  const finaleRef = useRef<{
    t0: number;
    a0: number;
    v0: number;
    target: number;
  } | null>(null);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useImperativeHandle(ref, () => ({
    think: () => {
      burstUntil.current = performance.now() + BURST_MS;
    },
    thinkHard: () => {
      burstUntil.current = performance.now() + 60_000;
    },
    thinkDone: () => {
      burstUntil.current = performance.now() + 400;
    },
    beginFinale: () => {
      if (finaleRef.current) return;
      const a0 = angleRef.current;
      finaleRef.current = {
        t0: performance.now(),
        a0,
        v0: velRef.current,
        // Next full turn at least UNWIND_MIN_DEG ahead — lands on
        // 0 mod 360, the static paint's native angle.
        target: 360 * Math.ceil((a0 + UNWIND_MIN_DEG) / 360),
      };
      setPhase("landing");
    },
  }));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    let lastWrite = "";
    let landedFrames = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const fin = finaleRef.current;
      let done = false;
      if (fin) {
        const t = now - fin.t0;
        // Rotation: quintic Hermite over LAND_MS — velocity-continuous
        // at entry (drift or mid-burst), zero velocity+acceleration at
        // the landing. θ(u) = a0 + v0·D·h1(u) + (T−a0)·smootherstep(u).
        const u = Math.min(1, t / LAND_MS);
        const u2 = u * u;
        const u3 = u2 * u;
        const h1 = u - 6 * u3 + 8 * u3 * u - 3 * u3 * u2;
        const sm = 10 * u3 - 15 * u3 * u + 6 * u3 * u2;
        angleRef.current =
          u >= 1
            ? fin.target
            : fin.a0 + fin.v0 * (LAND_MS / 1000) * h1 + (fin.target - fin.a0) * sm;
        // scaleY settles on its own longer track.
        const k = Math.min(1, t / SETTLE_MS);
        const k3 = k * k * k;
        const ksm = 10 * k3 - 15 * k3 * k + 6 * k3 * k * k;
        const scaleY = 1.15 + (1 - 1.15) * ksm;
        const next = `rotate(${(angleRef.current % 360).toFixed(2)}deg) scaleY(${scaleY.toFixed(4)})`;
        if (next !== lastWrite && sheetRef.current) {
          lastWrite = next;
          sheetRef.current.style.transform = next;
        }
        // Phase flips on this same clock: landed the frame the unwind
        // completes; shrink one full tick later (the guaranteed
        // daylight between filter teardown and geometry motion).
        if (u >= 1 && phaseRef.current === "landing") {
          setPhase("landed");
          landedFrames = 0;
        } else if (phaseRef.current === "landed") {
          landedFrames += 1;
          if (landedFrames >= 1) setPhase("shrink");
        }
        // The loop's work ends once scaleY has settled and the shrink
        // keyframes own all remaining motion.
        if (k >= 1 && phaseRef.current === "shrink") done = true;
      } else {
        // Idle velocity model: drift, burst on advances.
        const speed = now < burstUntil.current ? BURST_DEG_S : BASE_DEG_S;
        velRef.current += (speed - velRef.current) * Math.min(1, dt * 7);
        angleRef.current += velRef.current * dt;
        const next = `rotate(${(angleRef.current % 360).toFixed(2)}deg) scaleY(1.15)`;
        if (next !== lastWrite && sheetRef.current) {
          lastWrite = next;
          sheetRef.current.style.transform = next;
        }
      }
      onTickRef.current?.(now, dt);
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={"boot-scene" + (phase !== "idle" ? ` is-${phase}` : "")}>
      <div className="boot-frame" aria-hidden>
        <div className="boot-sheet" ref={sheetRef}>
          <div className="boot-paint-fit">
            <div className="boot-paint" />
          </div>
        </div>
      </div>
      <div className="boot-screen" aria-hidden />
      <p className="boot-wordmark" aria-hidden>
        BlammyTV
      </p>
    </div>
  );
});
