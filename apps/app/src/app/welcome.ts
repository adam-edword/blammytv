/** Launch gate + shared geometry for the ONE-PIECE boot motion (see
 * BootScene.tsx — rendered persistently by Onboarding.tsx and, for cold
 * boots, by WelcomeAnimation.tsx; both play the same boot.css keyframes
 * over the vars computed here). */

import type { CSSProperties } from "react";

const PLAYED_KEY = "btv:welcome-played";

/** Design space: Adam's Figma motion mock ("Wireframe - 5", node
 * 272:1000, the one-piece boot spec) — a 1920×1167 canvas. All boot
 * geometry below is native to it:
 * - the frame shrinks to a 121px logo tile whose center sits 302.5px
 *   left of canvas center;
 * - the black screen (the frame's 72/71.5-inset rect) shrinks to a
 *   68.57px hole concentric with the tile;
 * - the wordmark (116.22px Stack Sans Headline) slides in from +120.24.
 * The starting frame is the viewport itself, so the shrink's end scale
 * depends on the window: compute the per-axis factors that land the
 * viewport-sized elements on the fixed lockup geometry. --s carries the
 * mock's cover factor so the lockup itself sizes like the design.
 * SHARED by both boot surfaces — geometry must never drift.
 * (Known queued issue, carried over from lockupVars: under uiScale
 * zoom ≠ 1 these mix visual and layout px — see HANDOFF.) */
const DESIGN_W = 1920;
const DESIGN_H = 1167;
const TILE = 121; // final frame tile (square)
const HOLE = 68.57; // final screen hole (square)
const INSET_X = 144; // left + right screen inset (72 each)
const INSET_Y = 143; // top + bottom screen inset (71.5 each)

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
