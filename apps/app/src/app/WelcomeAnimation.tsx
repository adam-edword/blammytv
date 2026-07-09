import { useEffect, useState, type CSSProperties } from "react";
import { markWelcomePlayed } from "./welcome";

/** The Figma timeline ("BTV WELCOME ANIMATION", 194:1158) runs 2000ms:
 * the viewport-filling TV shrinks into the logo mark (~0–737ms), springs
 * left (~868–1856ms) and the wordmark fades in beside it (~1173–1850ms).
 * The opening TV sits START_HOLD_MS first (welcome.css delays the timeline
 * to match), the finished lockup sits END_HOLD_MS, then the overlay fades
 * out over the app. */
const TIMELINE_MS = 2000;
const START_HOLD_MS = 700;
const END_HOLD_MS = 1000;

/** End-state lockup geometry, in the mock's 1920×1080 pixels (see
 * welcome.css). The icon lands on the brand logo ("Subtract", 186:794) at
 * 0.48×: a 96px square tile with a 54.4px square hole (the logo's 200px
 * tile / 113.333px hole). The screen's frame is 36.5/35px thick at start. */
const DESIGN_W = 1920;
const DESIGN_H = 1080;
const ICON_W = 96;
const ICON_H = 96;
const HOLE_W = 54.4;
const HOLE_H = 54.4;
const FRAME_X = 70; // left + right frame thickness
const FRAME_Y = 73; // top + bottom frame thickness

/** The starting TV is the viewport itself, so the shrink's end scale
 * depends on the window: compute the per-axis factors that land the
 * viewport-sized elements on the fixed lockup geometry. --s carries the
 * mock's cover factor so the lockup itself sizes like the design. */
function lockupVars(): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.max(vw / DESIGN_W, vh / DESIGN_H);
  return {
    "--s": String(s),
    "--tv-sx": String((ICON_W * s) / vw),
    "--tv-sy": String((ICON_H * s) / vh),
    "--scr-sx": String((HOLE_W * s) / (vw - FRAME_X * s)),
    "--scr-sy": String((HOLE_H * s) / (vh - FRAME_Y * s)),
  } as CSSProperties;
}

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
