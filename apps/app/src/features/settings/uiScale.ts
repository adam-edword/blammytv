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
