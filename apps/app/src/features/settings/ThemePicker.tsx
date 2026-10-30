import { Button } from "../../components/ui/button";
import { THEME_PACKS, type ThemePack } from "./themePack";

/** Prism's card: the logo's ramp, small (its stops, left to right), over the
 * dither's dots, brighter than the page's so they read at card size. */
const RAMP = "linear-gradient(90deg, #ff93af, #ff7af6, #8696ff, #83ffa8, #ffe57e)";
const DOTS =
  "radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.28) 1px, transparent 1.3px)";

/** Selected card ring, as AccentPicker's swatches wear it. */
const ON_RING = "ring-2 ring-ring ring-offset-2 ring-offset-background";

/**
 * Settings → Appearance → Theme: Default and the three packs as cards, each
 * drawn in its own colours (the page, a surface on it, the accent) rather
 * than the app's, so a card reads the same whichever theme is on.
 */
export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemePack;
  onChange: (pack: ThemePack) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2.5" role="group" aria-label="Theme">
      {THEME_PACKS.map((p) => {
        const on = value === p.key;
        const prism = p.key === "prism";
        return (
          <Button
            key={p.key}
            variant="outline"
            type="button"
            aria-pressed={on}
            aria-label={p.label}
            className={"h-auto w-[116px] flex-col items-stretch gap-2 rounded-xl p-2" + (on ? ` ${ON_RING}` : "")}
            onClick={() => onChange(p.key)}
          >
            <span
              aria-hidden
              className="relative block h-12 overflow-hidden rounded-md border border-border"
              data-swatch={p.key}
              style={{
                background: p.swatch.bg,
                ...(prism ? { backgroundImage: DOTS, backgroundSize: "4px 4px" } : {}),
              }}
            >
              <span
                className="absolute inset-x-2 bottom-2 h-4 rounded-sm"
                style={{ background: p.swatch.surface }}
              />
              <span
                className={prism ? "absolute top-2 left-2 h-2 w-10 rounded-full" : "absolute top-2 left-2 size-3 rounded-full"}
                data-ramp={prism ? "" : undefined}
                style={{ background: prism ? RAMP : p.swatch.accent }}
              />
            </span>
            <span className="text-center text-xs">{p.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
