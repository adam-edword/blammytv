import { load, save } from "../../lib/storage";

/** Dark (the design's native palette) or light. Applied as data-theme on the
 * root; tokens.css swaps every theme-dependent token off that attribute. */
export type Theme = "dark" | "light";

/** What the user chose (plan 022): a theme, or Windows' own setting, which
 * WebView2 passes through as `prefers-color-scheme`. */
export type ThemePref = Theme | "system";

/** The picker's options, in Settings → Customize → Interface. */
export const THEME_TABS: Array<{ key: ThemePref; label: string }> = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "system", label: "Match Windows" },
];

// v1 stored "dark" or "light", and still reads the same; "system" is new.
const KEY = "theme";
const VERSION = 1;

export function loadThemePref(): ThemePref {
  const v = load<ThemePref>(KEY, VERSION, "dark");
  return v === "light" || v === "system" ? v : "dark";
}

export function saveThemePref(pref: ThemePref): void {
  save(KEY, VERSION, pref);
}

export function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

let followOs: (() => void) | null = null;

/** Apply a preference. "system" follows Windows live: changing it there
 * turns the app without a restart. Any other choice stops following. */
export function applyThemePref(pref: ThemePref): void {
  followOs?.();
  followOs = null;
  if (pref !== "system") {
    applyTheme(pref);
    return;
  }
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const sync = () => applyTheme(mq.matches ? "light" : "dark");
  sync();
  mq.addEventListener("change", sync);
  followOs = () => mq.removeEventListener("change", sync);
}
