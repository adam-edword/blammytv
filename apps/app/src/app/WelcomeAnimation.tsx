import { useEffect, useState } from "react";
import { lockupVars, markWelcomePlayed } from "./welcome";

/** The Figma timeline ("BTV WELCOME ANIMATION", 194:1158) runs 2000ms:
 * the viewport-filling TV shrinks into the logo mark (~0–737ms), springs
 * left (~868–1856ms) and the wordmark fades in beside it (~1173–1850ms).
 * The opening TV fades+unblurs in and sits START_HOLD_MS first (welcome.css
 * delays the timeline to match), the finished lockup sits END_HOLD_MS, then
 * the overlay fades out over the app.
 *
 * TWIN: onboarding's finale plays a copy of this timeline (onb-boot-* in
 * onboarding.css) — if the boot animation ever changes, update both. The
 * lockup geometry itself is shared (lockupVars in welcome.ts). */
const TIMELINE_MS = 2000;
const START_HOLD_MS = 700;
const END_HOLD_MS = 1000;

export function WelcomeAnimation({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [vars, setVars] = useState(lockupVars);

  useEffect(() => {
    markWelcomePlayed();
  }, []);

  useEffect(() => {
    const onResize = () => setVars(lockupVars());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Leave when the lockup has settled — or immediately on any input, so the
  // boot animation never stands between the user and the app.
  useEffect(() => {
    const skip = () => setLeaving(true);
    const timer = setTimeout(skip, START_HOLD_MS + TIMELINE_MS + END_HOLD_MS);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  return (
    <div
      className={"welcome-overlay" + (leaving ? " is-leaving" : "")}
      style={vars}
      onTransitionEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onDone();
      }}
    >
      <div className="welcome-backdrop">
        <div className="welcome-gradient-fit">
          <div className="welcome-gradient" />
        </div>
      </div>
      <div className="welcome-screen" />
      <p className="welcome-wordmark">BlammyTV</p>
    </div>
  );
}
