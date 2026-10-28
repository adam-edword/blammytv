import { load, save } from "../../lib/storage";

/**
 * Which look the featured carousel at the top of Stream has: the shelf
 * (plan 031, default) or the large one it replaced in v1.0.5, one wide card
 * with Watch Now and More Info on it.
 *
 * Read during render, as showHero is: App owns the Settings modal, so
 * closing it re-renders Stream and the change lands then. Only means
 * something while the carousel is on, so AppearancePage hides the picker
 * with it.
 */
export type HeroStyle = "shelf" | "large";

export const HERO_STYLES: Array<{ key: HeroStyle; label: string }> = [
  { key: "shelf", label: "Shelf" },
  { key: "large", label: "Large" },
];

const KEY = "heroStyle";
const VERSION = 1;

export function loadHeroStyle(): HeroStyle {
  return load<HeroStyle>(KEY, VERSION, "shelf") === "large" ? "large" : "shelf";
}

export function saveHeroStyle(style: HeroStyle): void {
  save(KEY, VERSION, style);
}
