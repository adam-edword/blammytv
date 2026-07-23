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
const CUSTOM_KEY = "accent-custom";
const VERSION = 1;

export function loadAccent(): string {
  const stored = load<string>(KEY, VERSION, DEFAULT_ACCENT);
  return isValidHex(stored) ? stored.toLowerCase() : DEFAULT_ACCENT;
}

export function saveAccent(hex: string): void {
  save(KEY, VERSION, hex.toLowerCase());
}

/** The last custom color, remembered separately so the custom swatch keeps
 * its color while a preset is selected. Empty until one is ever picked. */
export function loadCustomAccent(): string {
  const stored = load<string>(CUSTOM_KEY, VERSION, "");
  return isValidHex(stored) ? stored.toLowerCase() : "";
}

export function saveCustomAccent(hex: string): void {
  save(CUSTOM_KEY, VERSION, hex.toLowerCase());
}

/**
 * Accent STYLE: "flat" = a single hex feeds everything (the classic
 * system); "aurora" = gradient-capable surfaces read the gradient
 * tokens (tokens.css, scoped to [data-accent-style="aurora"]) while
 * everything thin — progress bars, box-shadow rings, text accents —
 * falls back to a representative flat hue through the SAME --accent
 * feed. Elements needing special treatment use classes scoped under
 * the root attribute (see the Aurora block in ui.css).
 */
export type AccentStyle = "flat" | "aurora";

/** The flat hue thin consumers read while Aurora is active. */
const AURORA_HUE = "#8b5cf6";

const STYLE_KEY = "accent-style";

export function loadAccentStyle(): AccentStyle {
  return load<string>(STYLE_KEY, VERSION, "flat") === "aurora"
    ? "aurora"
    : "flat";
}

export function saveAccentStyle(style: AccentStyle): void {
  save(STYLE_KEY, VERSION, style);
}

/** Push the accent into CSS; every derived shade follows via color-mix.
 * Also stands DOWN aurora — picking any flat color exits the style. */
export function applyAccent(hex: string): void {
  const root = document.documentElement;
  delete root.dataset.accentStyle;
  root.style.setProperty("--accent", hex);
}

/** Enter the Aurora style: gradient tokens activate via the root
 * attribute; --accent becomes the representative hue. */
export function applyAurora(): void {
  const root = document.documentElement;
  root.dataset.accentStyle = "aurora";
  root.style.setProperty("--accent", AURORA_HUE);
}

/**
 * Pack-paired accent bookkeeping (option 3): a theme pack may SUGGEST an
 * accent (ThemePackMeta.pairedAccent). Committing such a pack applies it —
 * but only while the accent is still the default red or a previous pack's
 * pairing; a hand-picked accent is never touched. This key records which
 * pack's pairing is active ("" = none) so committing an unpaired pack can
 * restore the default, and any manual accent pick clears it (the user's
 * choice always wins from then on).
 */
const PAIRED_KEY = "accent-paired-by";

export function loadAccentPairedBy(): string {
  return load<string>(PAIRED_KEY, VERSION, "");
}

export function saveAccentPairedBy(packId: string): void {
  save(PAIRED_KEY, VERSION, packId);
}

/** Aurora is an EASTER EGG: the swatch only appears in the picker once
 * the Custom chip has been spam-clicked ×10 (CustomizeTab counts).
 * Anyone already running aurora counts as unlocked — never lock
 * someone out of a style they're using. */
const EGG_KEY = "auroraUnlocked";

export function isAuroraUnlocked(): boolean {
  return load<boolean>(EGG_KEY, VERSION, false) || loadAccentStyle() === "aurora";
}

export function unlockAurora(): void {
  save(EGG_KEY, VERSION, true);
}
