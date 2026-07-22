import { load, save } from "../../lib/storage";

/** Dark (the design's native palette) or light. Applied as data-theme on the
 * root; tokens.css swaps every theme-dependent token off that attribute. */
export type Theme = "dark" | "light";

const KEY = "theme";
const VERSION = 1;

export function loadTheme(): Theme {
  return load<Theme>(KEY, VERSION, "dark") === "light" ? "light" : "dark";
}

export function saveTheme(theme: Theme): void {
  save(KEY, VERSION, theme);
}

export function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}
