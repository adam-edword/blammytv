import { load, save } from "../../lib/storage";

/**
 * Theme packs: named token bundles layered on top of tokens.css, scoped
 * under a root attribute (packs.css, [data-theme-pack="<id>"]). Orthogonal
 * to theme.ts's dark/light axis — a pack can support both (paper) or stay
 * single-axis (void, slate are dark-only). "classic" is the design's native
 * look and sets NO attribute, so it can never drift from today's tokens.
 *
 * ThemePackId is a bare string, not a closed union: paid packs arrive later
 * with ids this build has never heard of, carrying their own CSS payload
 * (see injectPackCss). Only THEME_PACKS enumerates the packs this build
 * ships and can render a picker card for.
 */
export type ThemePackId = string;

export type ThemePackMeta = {
  id: ThemePackId;
  name: string;
  blurb: string;
  supportsLight: boolean;
  /** Swatch hexes for the picker card. Raw hex is fine here — it's preview
   * chrome, not themable UI color. accent mirrors the app's own default
   * red: packs never own --accent, so the swatch shows the same accent
   * every pack will actually render with. lightBg (packs with a light axis
   * only) drives the diagonal dark/light split on the picker card. */
  preview: { bg: string; surface: string; accent: string; lightBg?: string };
  /** Paid pack (an intense theme). Free THEME_PACKS omit it. Drives the
   * lock badge + the preview-vs-commit branch in CustomizeTab: a premium
   * pack the machine doesn't own can be PREVIEWED live but never persisted
   * (see license.ts ownsPack). */
  premium?: boolean;
  /** Display price for the card, e.g. "$2.50". Premium packs only. */
  price?: string;
  /** Per-theme checkout link for "Unlock to keep". Premium packs only. */
  buyUrl?: string;
  /** Pass-exclusive secret theme: hidden from the picker entirely until the
   * machine holds a Themes Pass (no preview, no per-theme purchase). Also
   * draws the supporter heart on its card. */
  passOnly?: boolean;
  /** Premium-SHELF theme that costs nothing: listed and styled with the
   * premium roster, but owned by everyone (license.ts ownsPack) — picking
   * it commits like a free pack. No price/buyUrl. */
  freebie?: boolean;
  /** SUGGESTED accent (option-3 pairing): committing this pack applies the
   * hex — but only while the accent is still the default red or another
   * pack's pairing. A hand-picked accent is never touched (accent.ts,
   * accent-paired-by). Certain packs' looks are designed around an accent
   * (Kawaii's pink); this keeps the accent system user-owned. */
  pairedAccent?: string;
};

/** The brand default is BlammyTV (id "slate" for stored-pref compat).
 * "classic" is still the no-attribute pack — the raw tokens.css palette —
 * so applyThemePack special-cases CLASSIC_PACK, not DEFAULT_PACK. */
export const DEFAULT_PACK: ThemePackId = "slate";
export const CLASSIC_PACK: ThemePackId = "classic";

const PREVIEW_ACCENT = "#c22727";

export const THEME_PACKS: ReadonlyArray<ThemePackMeta> = [
  {
    // Kept id "slate" (a rename would orphan stored prefs); the look is the
    // brand neutral dark now, not the old blue graphite.
    id: "slate",
    name: "BlammyTV",
    blurb: "The BlammyTV signature look — soft neutral dark.",
    supportsLight: false,
    preview: { bg: "#0b0b0e", surface: "#1e1e25", accent: PREVIEW_ACCENT },
  },
  {
    id: "classic",
    name: "Classic",
    blurb: "The original BlammyTV look, near-black and untouched.",
    // Classic IS the raw tokens — tokens.css's light override is its light
    // variant, so the Light toggle must stay live on it.
    supportsLight: true,
    preview: {
      bg: "#050505",
      surface: "#333333",
      accent: PREVIEW_ACCENT,
      lightBg: "#efefef",
    },
  },
  {
    id: "void",
    name: "OLED",
    blurb: "OLED true black with crushed, inky surfaces.",
    supportsLight: false,
    preview: { bg: "#000000", surface: "#050505", accent: PREVIEW_ACCENT },
  },
  {
    id: "paper",
    name: "Paper",
    blurb: "Warm cream by day, warm charcoal by night.",
    supportsLight: true,
    preview: {
      bg: "#1a1917",
      surface: "#fffdf8",
      accent: PREVIEW_ACCENT,
      lightBg: "#f6f1e7",
    },
  },
  {
    id: "nebula",
    name: "Nebula",
    blurb: "Deep violet-noir with a faint stellar haze.",
    supportsLight: false,
    preview: { bg: "#0a0612", surface: "#1f1430", accent: PREVIEW_ACCENT },
  },
];

/** Paid, intense themes — BUNDLED in the app (styles/intense-packs.css), not
 * fetched. Every one is always shown in the picker and previewable without a
 * key; ownership (license.ts) only decides whether picking one persists.
 * A pack's block existing here + in intense-packs.css is the whole contract;
 * BUNDLED_INTENSE_IDS is the set the build can actually render. */
export const INTENSE_PACKS: ReadonlyArray<ThemePackMeta> = [
  {
    id: "terminal",
    name: "Terminal",
    blurb: "Green-phosphor CRT — bitmap type, dither grain, glowing hovers.",
    supportsLight: false,
    preview: { bg: "#020a05", surface: "#0a2c16", accent: PREVIEW_ACCENT },
    premium: true,
    price: "$2.50",
    // LIVE Payment Link (setup-stripe.mjs, 2026-07-16).
    buyUrl: "https://buy.stripe.com/bJe4gs0Qjf6r62Z9eI0Fi02",
  },
  {
    id: "dither",
    name: "Dither",
    blurb: "1-bit print-press halftone — a dot matrix screened over pure black.",
    supportsLight: false,
    preview: { bg: "#000000", surface: "#1e1e1e", accent: PREVIEW_ACCENT },
    premium: true,
    price: "$2.50",
    buyUrl: "https://buy.stripe.com/14A8wI7eHe2n0IF8aE0Fi03",
  },
  {
    id: "kawaii",
    name: "Kawaii ⸜(｡˃ ᵕ ˂ )⸝♡",
    blurb: "Midnight candy — pastel pink on a plum sky, chubby type, a star on the now-line.",
    supportsLight: false,
    preview: { bg: "#15111f", surface: "#e9e9f7", accent: "#f2a0c2" },
    premium: true,
    price: "$2.50",
    buyUrl: "https://buy.stripe.com/cNi4gs42v7DZ773bmQ0Fi04",
    pairedAccent: "#f2a0c2",
  },
  {
    id: "streamy",
    name: "Streamy",
    blurb: "That other client — deep indigo board, violet glow, familiar type.",
    supportsLight: false,
    preview: { bg: "#131126", surface: "#1d1a38", accent: "#7b5bf5" },
    premium: true,
    freebie: true,
    pairedAccent: "#7b5bf5",
  },
  {
    // The secret supporters theme — classic + the site's drifting rainbow
    // aura. Pass-exclusive: no buyUrl (never sold per-theme), passOnly hides
    // it until a Themes Pass is active.
    id: "supporter",
    name: "Supporter",
    blurb: "A thank-you for Pass holders — classic with a living rainbow aura.",
    supportsLight: false,
    preview: { bg: "#0b0b0e", surface: "#1a1030", accent: PREVIEW_ACCENT },
    premium: true,
    passOnly: true,
  },
];

/** Ids intense-packs.css actually defines a renderable block for — the guard
 * that entitlement (which can list ids this build predates) only surfaces
 * packs this build can paint. */
export const BUNDLED_INTENSE_IDS: ReadonlySet<ThemePackId> = new Set(
  INTENSE_PACKS.map((p) => p.id),
);

/** The Themes Pass: unlocks every premium theme plus the secret Supporter
 * theme, in one purchase. Price/link shown on the Themes panel's Pass block.
 * buyUrl is the LIVE Payment Link (setup-stripe.mjs). */
export const THEMES_PASS = {
  price: "$12.50",
  buyUrl: "https://buy.stripe.com/6oU8wI8iL7DZ2QN76A0Fi01",
} as const;

const KEY = "themePack";
const VERSION = 1;

/** An id outside THEME_PACKS is returned as-is (forward-compat: a paid
 * pack's id is valid once its CSS is fetched/injected, even though this
 * build's picker doesn't know its name yet). Applying an unknown id is
 * harmless by construction — no CSS block matches, so it renders classic. */
export function loadThemePack(): ThemePackId {
  return load<string>(KEY, VERSION, DEFAULT_PACK);
}

export function saveThemePack(id: ThemePackId): void {
  save(KEY, VERSION, id);
}

export function applyThemePack(id: ThemePackId): void {
  // Classic (not the default!) is the attribute-less pack — it IS tokens.css.
  if (id === CLASSIC_PACK) {
    delete document.documentElement.dataset.themePack;
  } else {
    document.documentElement.dataset.themePack = id;
  }
}

/**
 * The paid-payload seam: create (or replace) a <style data-pack-css="id">
 * element in <head> holding `css` verbatim. Re-injecting the same id
 * replaces its element rather than duplicating it. Built now so the future
 * fetch-and-unlock flow just calls this — no engine rework needed then.
 * No validation or sanitization happens here; that's the fetch layer's job
 * once payloads start arriving over the network.
 */
export function injectPackCss(id: ThemePackId, css: string): void {
  const existing = document.head.querySelector(
    `style[data-pack-css="${id}"]`,
  );
  existing?.remove();
  const style = document.createElement("style");
  style.dataset.packCss = id;
  style.textContent = css;
  document.head.appendChild(style);
}
