import { load, save } from "../../lib/storage";

/**
 * Accent color. Everything red in the design derives from the single
 * --accent custom property (via color-mix in tokens.css), so changing the
 * accent is just overriding that one variable on the document root.
 */

/** Quick-pick swatches; the custom picker covers everything else.
 *
 * NO LONGER "first entry is the default". v0.9.57 made the default no
 * accent at all — see loadAccent. Red heads the list because it is the
 * app's own colour and the one most people will reach for, not because it
 * is what ships. */
export const ACCENT_PRESETS: Array<{ hex: string; name: string }> = [
  { hex: "#c22727", name: "Red" },
  { hex: "#ffd500", name: "Yellow" },
  { hex: "#2cad57", name: "Green" },
  { hex: "#3730ff", name: "Blue" },
  { hex: "#a200ff", name: "Purple" },
  { hex: "#ff2773", name: "Pink" },
  { hex: "#9aa0b1", name: "Grey" },
];

/**
 * NOTHING, and that is the point.
 *
 * This used to be `#c22727`, and main.tsx wrote it onto `:root` as an
 * INLINE style on every launch. An inline style beats every stylesheet, so
 * v0.9.57's swap of `--accent` to shadcn's neutral primary changed nothing
 * on screen: the brand red was being painted back over it before the first
 * frame, on a fresh install with no stored preference.
 *
 * Empty means "the user has never chosen", and the boot path skips applying
 * anything at all, so `--accent` resolves from tokens.css. That is strictly
 * better than picking a hex here even if we wanted a neutral default: the
 * token FLIPS with the theme (near-white on dark, near-black on light) and
 * a single hex cannot.
 */
export const DEFAULT_ACCENT = "";

export function isValidHex(value: unknown): boolean {
  // `unknown`, not `string`, because one of its callers reads straight out
  // of storage and the type there is a promise nobody enforces. A number,
  // null or an object reached `.trim()` and threw, and loadAccent runs at
  // main.tsx BEFORE createRoot, so the whole app was a white window with no
  // console the user could see.
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

const KEY = "accent";
const CUSTOM_KEY = "accent-custom";
const VERSION = 1;

/**
 * The accent and its custom slot are on envelope v2 since v0.9.80, so a v1
 * value reads as "never chosen" (storage.ts drops a version mismatch).
 *
 * Because v1 cannot tell a choice from a side effect. 0.9.0 stored an
 * accent on a swatch click, but ALSO when Reset wrote the old brand red,
 * and when a theme pack wrote its paired colour (Streamy's purple,
 * Kawaii's pink). v0.9.79 put the boot line back and brought all of those
 * back with it, as colours nobody picked. Only a pick made in the picker
 * that shipped with the boot line counts, and that is a v2 write.
 *
 * The cost is that a colour someone did choose in 0.9.0 has to be chosen
 * once more, on an app whose whole palette changed since. The style,
 * pairing key stays on v1: it belongs to the theme packs, and comes back
 * with them.
 */
const PICK_VERSION = 2;

/** The chosen accent, or "" when there is none. Callers that need a colour
 * to render a swatch with should read the computed `--accent` instead. */
export function loadAccent(): string {
  const stored = load<string>(KEY, PICK_VERSION, DEFAULT_ACCENT);
  return isValidHex(stored) ? stored.toLowerCase() : DEFAULT_ACCENT;
}

export function saveAccent(hex: string): void {
  save(KEY, PICK_VERSION, hex.toLowerCase());
}

/** The last custom color, remembered separately so the custom swatch keeps
 * its color while a preset is selected. Empty until one is ever picked. */
export function loadCustomAccent(): string {
  const stored = load<string>(CUSTOM_KEY, PICK_VERSION, "");
  return isValidHex(stored) ? stored.toLowerCase() : "";
}

export function saveCustomAccent(hex: string): void {
  save(CUSTOM_KEY, PICK_VERSION, hex.toLowerCase());
}

/**
 * The ink that sits ON the accent, black or white, whichever wins.
 *
 * It exists because v0.9.57 made the DEFAULT accent shadcn's near-white
 * `primary`, so `--accent-ink` is near-black in dark mode. Pick a saturated
 * colour and that near-black lands on it: 2.6:1 for the old red, which is
 * unreadable. Fixed white is equally wrong the other way, and was the bug
 * this replaces — white on a near-white default button is invisible.
 *
 * sRGB relative luminance, the WCAG formula, against the 0.179 threshold
 * that is the exact crossover between black and white contrast. No
 * dependency and no guessing at a brightness cutoff.
 */
export function inkFor(hex: string): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6) return "oklch(0.985 0 0)";
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.179 ? "oklch(0.205 0 0)" : "oklch(0.985 0 0)";
}

/** Drop the inline accent so `--accent` resolves from tokens.css again.
 * The counterpart to applyAccent, and the only way back to the shadcn
 * default once a colour has been chosen — removeProperty, not setting a
 * neutral hex, because the token flips with the theme and a hex does not. */
export function clearAccent(): void {
  const root = document.documentElement;
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-ink");
}

/** Push the accent into CSS; every derived shade follows via color-mix. */
export function applyAccent(hex: string): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-ink", inkFor(hex));
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
