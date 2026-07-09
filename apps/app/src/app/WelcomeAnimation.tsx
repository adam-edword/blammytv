import { useEffect, useState } from "react";
import { markWelcomePlayed } from "./welcome";

/** The Figma timeline ("BTV WELCOME ANIMATION", 194:1158) runs 2000ms:
 * the full-screen TV shrinks into the logo mark (~0–737ms), springs left
 * (~868–1856ms) and the wordmark fades in beside it (~1173–1850ms). Hold
 * the finished lockup a beat, then fade the overlay out over the app. */
const TIMELINE_MS = 2000;
const HOLD_MS = 350;

/** The stage is authored in the mock's 1920×1080 coordinates and scaled to
 * COVER the window, so the gradient frame always reaches the edges. */
const DESIGN_W = 1920;
const DESIGN_H = 1080;

function coverScale(): number {
  return Math.max(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
}

export function WelcomeAnimation({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [scale, setScale] = useState(coverScale);

  useEffect(() => {
    markWelcomePlayed();
  }, []);

  useEffect(() => {
    const onResize = () => setScale(coverScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Leave when the lockup has settled — or immediately on any input, so the
  // boot animation never stands between the user and the app.
  useEffect(() => {
    const skip = () => setLeaving(true);
    const timer = setTimeout(skip, TIMELINE_MS + HOLD_MS);
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
      onTransitionEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onDone();
      }}
    >
      <div
        className="welcome-stage"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div className="welcome-backdrop">
          <div className="welcome-gradient" />
        </div>
        <div className="welcome-screen" />
        <p className="welcome-wordmark">BlammyTV</p>
      </div>
    </div>
  );
}
