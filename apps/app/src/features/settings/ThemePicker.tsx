import { useSyncExternalStore } from "react";
import { Button } from "../../components/ui/button";
import {
  THEME_PACKS,
  THEME_TIERS,
  subscribeShowing,
  type ThemePack,
} from "./themePack";

/** Prism's card: the logo's ramp, small (its stops, left to right), over the
 * dither's dots, brighter than the page's so they read at card size. */
const RAMP =
  "linear-gradient(90deg, #ff93af, #ff7af6, #8696ff, #83ffa8, #ffe57e)";
const DOTS =
  "radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.28) 1px, transparent 1.3px)";

/** Selected card ring, as AccentPicker's swatches wear it. */
const ON_RING = "ring-2 ring-ring ring-offset-2 ring-offset-background";

/**
 * Settings → Appearance → Theme: Default and the packs as cards, grouped by
 * tier, each drawn in its own colours (the page, a surface on it, the accent)
 * rather than the app's, so a card reads the same whichever theme is on.
 */
export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemePack;
  onChange: (pack: ThemePack) => void;
}) {
  // A pack with a face for Light draws that face while the app is Light.
  const light = useSyncExternalStore(
    subscribeShowing,
    () => document.documentElement.dataset.theme === "light",
  );
  // Groups wrap side by side: a row each would be three rows for seven cards,
  // with Default alone on the first.
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-3" role="group" aria-label="Theme">
      {THEME_TIERS.map(({ tier, label }) => (
        <div
          key={tier}
          role="group"
          aria-labelledby={`theme-tier-${tier}`}
          data-theme-tier={tier}
        >
          <p
            id={`theme-tier-${tier}`}
            className="mb-1.5 text-xs text-muted-foreground"
          >
            {label}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {THEME_PACKS.filter((p) => p.tier === tier).map((p) => {
              const on = value === p.key;
              const prism = p.key === "prism";
              const swatch = light && p.light ? p.light.swatch : p.swatch;
              return (
                <Button
                  key={p.key}
                  variant="outline"
                  type="button"
                  aria-pressed={on}
                  aria-label={p.label}
                  data-picker="theme"
                  className={
                    "h-auto w-[116px] flex-col items-stretch gap-2 rounded-xl p-2" +
                    (on ? ` ${ON_RING}` : "")
                  }
                  onClick={() => onChange(p.key)}
                >
                  <span
                    aria-hidden
                    className="relative block h-12 overflow-hidden rounded-md border border-border"
                    data-swatch={p.key}
                    style={{
                      background: swatch.bg,
                      ...(prism
                        ? { backgroundImage: DOTS, backgroundSize: "4px 4px" }
                        : {}),
                    }}
                  >
                    <span
                      className="absolute inset-x-2 bottom-2 h-4 rounded-sm"
                      style={{ background: swatch.surface }}
                    />
                    <span
                      className={
                        prism
                          ? "absolute top-2 left-2 h-2 w-10 rounded-full"
                          : "absolute top-2 left-2 size-3 rounded-full"
                      }
                      data-ramp={prism ? "" : undefined}
                      style={{ background: prism ? RAMP : swatch.accent }}
                    />
                  </span>
                  <span className="text-center text-xs">{p.label}</span>
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
