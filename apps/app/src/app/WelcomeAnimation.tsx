import { useEffect, useRef, useState } from "react";
import { BootScene, BOOT_TIMELINE_MS, type BootSceneHandle } from "./BootScene";
import { bootVars, markWelcomePlayed } from "./welcome";

/** Cold-boot overlay: a thin host around the ONE-PIECE BootScene (the
 * same component and boot.css keyframes onboarding's finale plays —
 * one spec everywhere, no twins). The overlay itself is OPAQUE BLACK
 * from the first frame — it mounts in the app's first render and the
 * shell must never peek through (v0.4.42). The entrance is the
 * scene's own: the sheet fades in over black in its drifting idle
 * state, breathes for a beat, then plays the full unwind → unblur →
 * shrink → lockup timeline and fades off the app.
 *
 * Unlike onboarding's finale, a cold boot is SKIPPABLE on any input —
 * the boot must never stand between the user and the app. Leaving is
 * pure root opacity, so skipping mid-anything is safe. */
const ENTRANCE_MS = 400;
const DRIFT_MS = 500;
const END_FADE_OVERLAP_MS = 200;
const FADE_MS = 450;

export function WelcomeAnimation({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [vars, setVars] = useState(bootVars);
  const bootRef = useRef<BootSceneHandle>(null);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    markWelcomePlayed();
  }, []);

  useEffect(() => {
    const onResize = () => setVars(bootVars());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Leave when the lockup has settled (the fade overlaps its hold's
  // tail) — or immediately on any input.
  useEffect(() => {
    const skip = () => setLeaving(true);
    const start = window.setTimeout(
      () => bootRef.current?.beginFinale(),
      ENTRANCE_MS + DRIFT_MS,
    );
    const leave = window.setTimeout(
      skip,
      ENTRANCE_MS + DRIFT_MS + BOOT_TIMELINE_MS - END_FADE_OVERLAP_MS,
    );
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(leave);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  // The exit is time-boxed, never transitionend-dependent (Chromium can
  // swallow transitionend in occluded windows — old scar).
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    }, FADE_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  return (
    <div
      className={"boot-overlay" + (leaving ? " is-leaving" : "")}
      style={vars}
    >
      <BootScene ref={bootRef} />
    </div>
  );
}
