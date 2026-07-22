/** Launch gate + shared geometry for the ONE-PIECE boot motion (see
 * BootScene.tsx — rendered persistently by Onboarding.tsx and, for cold
 * boots, by WelcomeAnimation.tsx; both play the same boot.css keyframes
 * over the vars computed here). */

import type { CSSProperties } from "react";

const PLAYED_KEY = "btv:welcome-played";

/** Design space: Adam's Figma motion mock ("Wireframe - 5", node
 * 272:1000, the one-piece boot spec) — a 1920×1167 canvas. All boot
 * geometry below is native to it. v0.4.40 sized the END LOCKUP to the
 * onboarding splash's measured footprint; v0.4.41 y-centered it,
 * halved the frame border to the old released thickness, and brought
 * back the old endgame motion:
 * - the frame shrinks to a 76px logo tile whose center springs to
 *   213.59px left of canvas center (y-centered);
 * - the black screen (the frame's 35/36.5-inset rect) shrinks to a
 *   43.07px hole concentric with the tile (the mock's 68.57/121 ratio);
 * - the wordmark (84px Stack Sans Headline) fades in at its final
 *   position (no slide — the old motion).
 * The starting frame is the viewport itself, so the shrink's end scale
 * depends on the window: compute the per-axis factors that land the
 * viewport-sized elements on the fixed lockup geometry. --s carries the
 * mock's cover factor so the lockup itself sizes like the design.
 * SHARED by both boot surfaces — geometry must never drift.
 * UI scale: both hosts counter-zoom the root's zoom (they are exempt
 * from UI scale, v0.4.43), so 1 local px = 1 true px in them and the
 * innerWidth-based math here is correct at every scale notch. */
const DESIGN_W = 1920;
const DESIGN_H = 1167;
const TILE = 76; // final frame tile (square) — splash .onb-mark size
const HOLE = 43.07; // final screen hole (square) — TILE × 68.57/121
const INSET_X = 70; // left + right screen inset (35 each)
const INSET_Y = 73; // top + bottom screen inset (36.5 each)

export function bootVars(): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.max(vw / DESIGN_W, vh / DESIGN_H);
  return {
    "--s": String(s),
    "--tv-sx": String((TILE * s) / vw),
    "--tv-sy": String((TILE * s) / vh),
    "--scr-sx": String((HOLE * s) / (vw - INSET_X * s)),
    "--scr-sy": String((HOLE * s) / (vh - INSET_Y * s)),
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
