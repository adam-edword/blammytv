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
   * every pack will actually render with. */
  preview: { bg: string; surface: string; accent: string };
};

export const DEFAULT_PACK: ThemePackId = "classic";

const PREVIEW_ACCENT = "#c22727";

export const THEME_PACKS: ReadonlyArray<ThemePackMeta> = [
  {
    id: "classic",
    name: "Classic",
    blurb: "The original BlammyTV look, pure black and untouched.",
    // Classic IS today's look — tokens.css's light override is its light
    // variant, so the Light toggle must stay live on it.
    supportsLight: true,
    preview: { bg: "#000000", surface: "#0f0f0f", accent: PREVIEW_ACCENT },
  },
  {
    id: "void",
    name: "OLED",
    blurb: "OLED true black with crushed, inky surfaces.",
    supportsLight: false,
    preview: { bg: "#000000", surface: "#050505", accent: PREVIEW_ACCENT },
  },
  {
    id: "slate",
    name: "Slate",
    blurb: "Cool graphite with a blue-tinted edge.",
    supportsLight: false,
    preview: { bg: "#0d1117", surface: "#161b22", accent: PREVIEW_ACCENT },
  },
  {
    id: "paper",
    name: "Paper",
    blurb: "Warm cream by day, warm charcoal by night.",
    supportsLight: true,
    preview: { bg: "#f6f1e7", surface: "#fffdf8", accent: PREVIEW_ACCENT },
  },
];

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
  if (id === DEFAULT_PACK) {
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
