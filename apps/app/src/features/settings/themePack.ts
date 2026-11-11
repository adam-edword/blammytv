import { load, save } from "../../lib/storage";
import {
  applyAccent,
  clearAccent,
  defaultAccentStore,
  isValidHex,
  type AccentStore,
} from "./accent";
import { tauriMica } from "../../lib/tauri";

/**
 * Theme packs (plan 035): Prism, Velvet and Lagoon, dark only, Fluent and
 * Frutiger Aero, which also have a face for Light, and Classic, one look in
 * both. A pack changes colour, type, texture, light and transparency, never a
 * radius, a shape or a layout (Adam, 1.3). The palettes are styles/packs.css;
 * this is the choice, which accent is on the root while it is made, and
 * Fluent's Mica.
 *
 * "none" is Default and the base palette: it removes `data-theme-pack`
 * rather than naming a pack (old/themes/README.md is why there is no default
 * pack). Stored like accent.ts, validated on the way in.
 */
export type ThemePack = "none" | "prism" | "velvet" | "lagoon" | "fluent" | "classic" | "aero";

export interface PackInfo {
  key: ThemePack;
  label: string;
  /** What its card shows: the page, a surface on it, and the accent. */
  swatch: { bg: string; surface: string; accent: string };
  /** The pack's own accent, for one that takes a pick of its own. Null for
   * Default, which has the Accent picker as it always did, and for Prism,
   * whose ramp is its accent and which has no picker. */
  accent: string | null;
  /** Set on a pack that also has a face for Light (Fluent's): its card and its
   * own accent there. A pack without it is inert in Light, bar a tier-3 one
   * with one look (Classic). */
  light?: { swatch: PackInfo["swatch"]; accent: string };
  /** How far a pack may go (plan 035, Tiers): 1 colours only, 2 colours,
   * effects and fonts with the radius rule, 3 a full overhaul of corners,
   * borders and bevels (layout moves only where the plan says). A tier-3
   * pack shows in Light too: Classic with the one look, Fluent with `light`. */
  tier: 1 | 2 | 3;
}

export const THEME_PACKS: readonly PackInfo[] = [
  {
    key: "none",
    label: "Default",
    swatch: { bg: "oklch(0.145 0 0)", surface: "oklch(0.205 0 0)", accent: "oklch(0.922 0 0)" },
    accent: null,
    tier: 1,
  },
  {
    key: "prism",
    label: "Prism",
    swatch: { bg: "#000000", surface: "#111111", accent: "#ffffff" },
    accent: null,
    tier: 2,
  },
  {
    key: "velvet",
    label: "Velvet",
    swatch: { bg: "#170d10", surface: "#251619", accent: "#e8bb6c" },
    accent: "#e8bb6c",
    tier: 2,
  },
  {
    key: "lagoon",
    label: "Lagoon",
    swatch: { bg: "#08191e", surface: "#102d34", accent: "#5fe1c1" },
    accent: "#5fe1c1",
    tier: 2,
  },
  {
    // Windows 11's dark layers on Mica (#202020 where Mica can't show), and
    // Windows' default dark accent. Light is its light layers (#f3f3f3, white
    // cards) and Windows' default light accent.
    key: "fluent",
    label: "Fluent",
    swatch: { bg: "#202020", surface: "#2b2b2b", accent: "#60cdff" },
    accent: "#60cdff",
    light: { swatch: { bg: "#f3f3f3", surface: "#ffffff", accent: "#0067c0" }, accent: "#0067c0" },
    tier: 3,
  },
  {
    // Windows 2000: the grey face, the navy title bar (styles/classic.css).
    key: "classic",
    label: "Classic",
    swatch: { bg: "#d4d0c8", surface: "#ffffff", accent: "#0a246a" },
    accent: "#0a246a",
    tier: 3,
  },
  {
    // Night (Dark) is the entry itself, Daylight (Light) is `light`: aqua
    // with a green second colour, a value per face that reads on it.
    key: "aero",
    label: "Frutiger Aero",
    swatch: { bg: "#03304d", surface: "#154361", accent: "#3cc3ff" },
    accent: "#3cc3ff",
    light: { swatch: { bg: "#bfe6ff", surface: "#daf1ff", accent: "#0a8fdc" }, accent: "#0a8fdc" },
    tier: 2,
  },
];

/** The picker's groups, one per tier, in the words a user reads (Adam,
 * 1.2.14: "group the themes by their tier"). */
export const THEME_TIERS: readonly { tier: PackInfo["tier"]; label: string }[] = [
  { tier: 1, label: "Colors" },
  { tier: 2, label: "Colors and Effects" },
  { tier: 3, label: "Redesigns" },
];

export function packInfo(key: ThemePack): PackInfo {
  return THEME_PACKS.find((p) => p.key === key) ?? THEME_PACKS[0];
}

export function isThemePack(value: unknown): value is ThemePack {
  return THEME_PACKS.some((p) => p.key === value);
}

const KEY = "themePack";
const ACCENTS_KEY = "themeAccents";
const VERSION = 1;

export function loadThemePack(): ThemePack {
  const stored = load<unknown>(KEY, VERSION, "none");
  return isThemePack(stored) ? stored : "none";
}

export function saveThemePack(pack: ThemePack): void {
  save(KEY, VERSION, pack);
}

/** Keyed by pack, and `pack:light` for a pack's Light face. */
type Picks = Record<string, { accent: string; custom: string }>;

const pickKey = (pack: ThemePack, light: boolean): string =>
  light && packInfo(pack).light ? `${pack}:light` : pack;

/** Each pack's remembered pick, as stored. A bad shape or a bad colour reads
 * as "never picked". */
function loadPicks(): Picks {
  const stored = load<unknown>(ACCENTS_KEY, VERSION, {});
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const out: Picks = {};
  for (const info of THEME_PACKS) {
    for (const key of info.light ? [info.key, `${info.key}:light`] : [info.key]) {
      const e = (stored as Record<string, { accent?: unknown; custom?: unknown } | null>)[key];
      if (!info.accent || !e || typeof e !== "object") continue;
      out[key] = {
        accent: isValidHex(e.accent) ? (e.accent as string).toLowerCase() : "",
        custom: isValidHex(e.custom) ? (e.custom as string).toLowerCase() : "",
      };
    }
  }
  return out;
}

/** The accent and custom slot a pack remembers for itself, one set per face
 * for a pack that has a Light face. An empty accent means the pack's own
 * colour, as the default store's means no accent. */
export function themeAccentStore(pack: ThemePack, light = false): AccentStore {
  const key = pickKey(pack, light);
  const read = () => loadPicks()[key] ?? { accent: "", custom: "" };
  const write = (next: { accent: string; custom: string }) =>
    save(ACCENTS_KEY, VERSION, { ...loadPicks(), [key]: next });
  return {
    get: () => read().accent,
    set: (hex) => write({ ...read(), accent: hex.toLowerCase() }),
    getCustom: () => read().custom,
    setCustom: (hex) => write({ ...read(), custom: hex.toLowerCase() }),
  };
}

/** Reset Appearance: every pack goes back to its own accent. */
export function resetThemeAccents(): void {
  save(ACCENTS_KEY, VERSION, {});
}

/** Whether a pack shows in a face: chosen, and the page is dark, or the pack
 * has a look for Light (a tier-3 pack: Classic's one look, Fluent's own). */
export function packShowingIn(pack: ThemePack, light: boolean): boolean {
  return pack !== "none" && (!light || packInfo(pack).tier === 3 || !!packInfo(pack).light);
}

/** The accent a pack opens on in this face: Fluent's Light has its own. */
export function faceAccent(info: PackInfo, light: boolean): string | null {
  return light && info.light ? info.light.accent : info.accent;
}

/** Whether a pack is showing on the root's face. */
export function packShowing(
  pack: ThemePack,
  root: { dataset: DOMStringMap } = document.documentElement,
): boolean {
  return packShowingIn(pack, root.dataset.theme === "light");
}

/**
 * Put the right accent on the root. Under a pack that takes one, the pack's
 * own pick; under Prism, none (its ramp is the accent, so the pack's colour
 * shows); otherwise the default pick. Inline, as accent.ts always writes it,
 * because that is what beats the pack's stylesheet. Runs when the pack
 * changes and when light or dark does, so Light keeps the default pick unless
 * the pack has a face for it, which remembers its own. No pick leaves the
 * accent to the stylesheet (fluent-tokens.css has Fluent's Light blue).
 */
export function syncAccent(): void {
  const root = document.documentElement;
  const pack = isThemePack(root.dataset.themePack) ? root.dataset.themePack : "none";
  const hex = packShowing(pack, root)
    ? packInfo(pack).accent
      ? themeAccentStore(pack, root.dataset.theme === "light").get()
      : ""
    : defaultAccentStore.get();
  if (hex) applyAccent(hex);
  else clearAccent();
}

/** useSyncExternalStore's pair for "is Prism showing": chosen, and dark. */
export function subscribeShowing(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-theme-pack"],
  });
  return () => mo.disconnect();
}
export const prismShowing = (): boolean =>
  document.documentElement.dataset.themePack === "prism" &&
  document.documentElement.dataset.theme !== "light";
/** Frutiger Aero's bubbles: chosen, in either face. */
export const aeroShowing = (): boolean => document.documentElement.dataset.themePack === "aero";

let watching = false;

/** Whether the window was last asked to have Mica. Starts false: a window
 * opens without it, so a profile that never wore Fluent never calls native. */
let micaAsked = false;
/** The face it was last asked for. */
let micaDark = true;
/** Orders the answers: the last question decides the root, not the last reply. */
let micaSeq = 0;

/**
 * Fluent's Mica: asked for while Fluent is chosen, in either face, taken off
 * the moment anything else is. Only a change calls native, and a flip between
 * dark and light is one (the title bar follows the face). `data-mica="on"`
 * goes on the root when native says the window has it, and packs.css (dark)
 * and fluent-tokens.css (light) let the page go see-through on that; without
 * it (Windows 10, a failed call, the browser build) Fluent's base stays solid.
 * Off is synchronous, so the base is solid before Mica goes.
 */
function syncMica(): void {
  const root = document.documentElement;
  const want = root.dataset.themePack === "fluent";
  const dark = root.dataset.theme !== "light";
  if (!want) delete root.dataset.mica;
  if (want === micaAsked && (!want || dark === micaDark)) return;
  micaAsked = want;
  micaDark = dark;
  const seq = ++micaSeq;
  void tauriMica(want, dark).then((applied) => {
    if (seq !== micaSeq || !want) return;
    if (applied) root.dataset.mica = "on";
    else delete root.dataset.mica;
  });
}

/** Apply a pack, and keep the accent and Mica right as light and dark change. */
export function applyThemePack(pack: ThemePack): void {
  const root = document.documentElement;
  if (pack === "none") delete root.dataset.themePack;
  else root.dataset.themePack = pack;
  syncAccent();
  syncMica();
  if (!watching && typeof MutationObserver !== "undefined") {
    watching = true;
    new MutationObserver(() => {
      syncAccent();
      syncMica();
    }).observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
}
