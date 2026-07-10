import { load, save } from "../../lib/storage";

/** Whole-UI zoom. Discrete notches keep layouts predictable; applied via
 * CSS zoom on the root so everything (including fixed elements) scales. */

export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2] as const;
export type UiScale = (typeof UI_SCALES)[number];

const KEY = "uiScale";
const VERSION = 1;

export function loadUiScale(): UiScale {
  const stored = load<number>(KEY, VERSION, 1);
  return (UI_SCALES as readonly number[]).includes(stored)
    ? (stored as UiScale)
    : 1;
}

export function saveUiScale(scale: UiScale): void {
  save(KEY, VERSION, scale);
}

export function applyUiScale(scale: UiScale): void {
  document.documentElement.style.zoom = String(scale);
}

/** The active root zoom, for code that crosses coordinate spaces.
 * getBoundingClientRect returns VISUAL (zoom-included) viewport px, but any
 * CSS length written on an element inside the zoomed root is re-multiplied
 * by the zoom at paint — so clip-paths and fixed positioning built from
 * measured rects must divide by this first. (Verified against Chromium:
 * a slot laid out at 100px reads back 120px at zoom 1.2, and a fixed
 * element given left:120px paints at 144px.) */
export function currentZoom(): number {
  return Number(document.documentElement.style.zoom || 1) || 1;
}
