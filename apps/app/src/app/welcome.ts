/** Launch gate + shared geometry for the welcome/boot animation (see
 * WelcomeAnimation.tsx — and Onboarding.tsx, whose finale plays a mimic
 * copy of the boot timeline over the same geometry). */

import type { CSSProperties } from "react";

const PLAYED_KEY = "btv:welcome-played";

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
 * mock's cover factor so the lockup itself sizes like the design.
 * SHARED between the boot animation and onboarding's finale mimic — the
 * keyframes are twins (copied), but the geometry must never drift. */
export function lockupVars(): CSSProperties {
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

/** Play on a fresh window launch only: reloads (HMR, dev-flag
 * flip) keep sessionStorage, so they skip it. `?welcome=1` forces a replay
 * and reduced-motion users never see it. Pure — the flag is stamped by
 * `markWelcomePlayed` on mount, not here (StrictMode calls useState
 * initializers twice). */
export function shouldPlayWelcome(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("welcome") === "1") return true;
  try {
    return sessionStorage.getItem(PLAYED_KEY) === null;
  } catch {
    return true;
  }
}

export function markWelcomePlayed(): void {
  try {
    sessionStorage.setItem(PLAYED_KEY, "1");
  } catch {
    /* storage unavailable — worst case it replays on reload */
  }
}
