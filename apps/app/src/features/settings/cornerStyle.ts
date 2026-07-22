import { load, save } from "../../lib/storage";

/**
 * Corner geometry for the whole app. Every rounded corner runs through the
 * --corner token (and its border-radius), so this is one attribute flip:
 * squircle (the default superellipse), classic round, or sharp (radii zeroed
 * via the data-corners rule in tokens.css).
 */

export type CornerStyle = "squircle" | "round" | "sharp";

const KEY = "cornerStyle";
const VERSION = 1;

export function loadCornerStyle(): CornerStyle {
  const stored = load<CornerStyle>(KEY, VERSION, "squircle");
  return stored === "round" || stored === "sharp" ? stored : "squircle";
}

export function saveCornerStyle(style: CornerStyle): void {
  save(KEY, VERSION, style);
}

export function applyCornerStyle(style: CornerStyle): void {
  if (style === "squircle") {
    delete document.documentElement.dataset.corners;
  } else {
    document.documentElement.dataset.corners = style;
  }
}
