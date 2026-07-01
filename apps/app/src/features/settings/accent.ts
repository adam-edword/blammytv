import { load, save } from "../../lib/storage";

/**
 * Accent color. Everything red in the design derives from the single
 * --accent custom property (via color-mix in tokens.css), so changing the
 * accent is just overriding that one variable on the document root.
 */

/** Quick-pick swatches (carried over from the old app); the custom picker
 * covers everything else. First entry is the default. */
export const ACCENT_PRESETS: Array<{ hex: string; name: string }> = [
  { hex: "#c22727", name: "Red" },
  { hex: "#ffd500", name: "Yellow" },
  { hex: "#2cad57", name: "Green" },
  { hex: "#3730ff", name: "Blue" },
  { hex: "#a200ff", name: "Purple" },
  { hex: "#ff2773", name: "Pink" },
  { hex: "#9aa0b1", name: "Grey" },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;

export function isValidHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

const KEY = "accent";
const VERSION = 1;

export function loadAccent(): string {
  const stored = load<string>(KEY, VERSION, DEFAULT_ACCENT);
  return isValidHex(stored) ? stored.toLowerCase() : DEFAULT_ACCENT;
}

export function saveAccent(hex: string): void {
  save(KEY, VERSION, hex.toLowerCase());
}

/** Push the accent into CSS; every derived shade follows via color-mix. */
export function applyAccent(hex: string): void {
  document.documentElement.style.setProperty("--accent", hex);
}
