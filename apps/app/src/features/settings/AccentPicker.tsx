import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { CheckIcon, EyeDropperIcon } from "../../ui/icons";
import {
  ACCENT_PRESETS,
  applyAccent,
  clearAccent,
  inkFor,
  isValidHex,
  loadAccent,
  loadCustomAccent,
  saveAccent,
  saveAccentPairedBy,
  saveCustomAccent,
} from "./accent";

/**
 * The accent picker, back from old/themes on its own (ROADMAP decision 1).
 *
 * It lived inside the Themes panel until v0.9.58 parked that panel, and
 * Adam asked for it back before themes return: "Can this come back now?"
 * The plumbing never left. `applyAccent` sets `--accent` and a computed
 * `--accent-ink`, and the shadcn bridge maps `--color-primary` and
 * `--color-primary-foreground` onto exactly those, so every primary button
 * takes the colour with readable text on it without this file knowing.
 *
 * Built on the primitives from the start rather than ported: swatches are
 * Button, the custom picker is Popover, the hex field is Input. What did
 * NOT come back is Aurora and its ten-click easter egg; every current look
 * is being removed (ROADMAP decision 1).
 *
 * THE DEFAULT IS "NO ACCENT", not a colour. Since v0.9.57 an empty accent
 * means `--accent` resolves from tokens.css, which flips with light and dark
 * and a stored hex cannot. So the first swatch is drawn as that flip rather
 * than as a colour, and picking it removes the inline value rather than
 * writing one.
 */

/** Chromium's EyeDropper, which WebView2 has. Absent elsewhere, and the
 * button simply does not render there. */
type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
const eyeDropper = (window as { EyeDropper?: EyeDropperCtor }).EyeDropper;

/** Selected swatch ring. `ring-offset` so the ring reads as a halo around
 * the colour rather than a border painted onto it. */
const ON_RING = "ring-2 ring-ring ring-offset-2 ring-offset-background";

export function AccentPicker({
  portalContainer,
}: {
  /** Where the Custom popover portals. Onboarding passes its own root,
   * because that overlay counter-zooms the UI scale and <body> does not:
   * on a replay at scale 1.2, a popover on <body> measured 190px right of
   * its chip, 101px low and 20% too big. Inside the overlay it shares the
   * overlay's zoom. */
  portalContainer?: HTMLElement | null;
} = {}) {
  const [accent, setAccent] = useState(loadAccent);
  const [custom, setCustom] = useState(loadCustomAccent);
  // Seeded from whatever the Custom chip will show, for the same reason as
  // `customShown` below.
  const [draft, setDraft] = useState(() => {
    const a = loadAccent();
    const shown =
      a !== "" && !ACCENT_PRESETS.some((p) => p.hex === a) ? a : loadCustomAccent();
    return shown.slice(1);
  });

  const isPreset = ACCENT_PRESETS.some((p) => p.hex === accent);
  const customOn = accent !== "" && !isPreset;
  // What the Custom chip shows. The ACTIVE colour whenever custom is on,
  // not only the remembered custom slot: a stored accent that is not a
  // preset but has no custom slot beside it (an older profile, or a colour
  // a preset list no longer carries) otherwise ticks Custom while drawing
  // the empty rainbow, which reads as "nothing chosen". Caught on a
  // screenshot, not by a test.
  const customShown = customOn ? accent : custom;

  const pick = (hex: string) => {
    const value = hex.toLowerCase();
    setAccent(value);
    saveAccent(value);
    applyAccent(value);
    // A pick ends any theme pack's paired accent: the user's choice wins.
    saveAccentPairedBy("");
  };

  const pickDefault = () => {
    setAccent("");
    saveAccent("");
    clearAccent();
    saveAccentPairedBy("");
  };

  const pickCustom = (hex: string) => {
    const value = hex.toLowerCase();
    setCustom(value);
    saveCustomAccent(value);
    setDraft(value.slice(1));
    pick(value);
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label="Accent color">
      <Button
        variant="outline"
        size="icon"
        type="button"
        aria-pressed={accent === ""}
        aria-label="Default, follows light and dark"
        title="Default"
        className={
          "size-8 rounded-full hover:opacity-90" + (accent === "" ? ` ${ON_RING}` : "")
        }
        // Half each theme's ink, because the default is not a colour: it is
        // near-white on dark and near-black on light, and a single fill
        // would claim otherwise.
        style={{
          background:
            "linear-gradient(135deg, var(--color-foreground) 50%, var(--color-background) 50%)",
        }}
        onClick={pickDefault}
      >
        {accent === "" && (
          // On its own chip, because the diagonal runs straight through
          // the middle: a bare tick (even blended) straddled both halves
          // and half of it vanished. `size-3` because Button's svg rule
          // overrides the `size` prop on every icon inside it.
          <span className="grid size-[18px] place-items-center rounded-full bg-background text-foreground shadow-sm">
            <CheckIcon className="size-3" />
          </span>
        )}
      </Button>

      {ACCENT_PRESETS.map((p) => {
        const on = accent === p.hex;
        return (
          <Button
            key={p.hex}
            variant="outline"
            size="icon"
            type="button"
            aria-pressed={on}
            aria-label={p.name}
            title={p.name}
            className={"size-8 rounded-full hover:opacity-90" + (on ? ` ${ON_RING}` : "")}
            // Inline, so the outline variant's own hover fill and text colour
            // cannot repaint the swatch: an inline value outranks every
            // utility. `color` is the tick, in whichever of black or white
            // reads on this swatch (the same rule `--accent-ink` uses).
            style={{
              backgroundColor: p.hex,
              borderColor: p.hex,
              color: inkFor(p.hex),
            }}
            onClick={() => pick(p.hex)}
          >
            {on && <CheckIcon className="size-3.5" />}
          </Button>
        );
      })}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            type="button"
            aria-pressed={customOn}
            className={"rounded-full pl-1.5" + (customOn ? ` ${ON_RING}` : "")}
            onClick={() => {
              // Re-selecting the remembered custom colour is one click, the
              // same as a preset, rather than a trip into the picker.
              if (custom && !customOn) pick(custom);
            }}
          >
            <span
              aria-hidden
              className="size-5 rounded-full border border-border"
              style={{
                background: customShown
                  ? customShown
                  : "conic-gradient(#f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e)",
              }}
            />
            Custom
          </Button>
        </PopoverTrigger>
        {/* `accent-picker` is only the scope for vendor.css's react-colorful
         * overrides. It was `accent-popover` until v0.9.80, which is also
         * the old Themes picker's class: settings.css still positioned it
         * absolutely, the Radix wrapper measured 0x0, and the popover
         * opened 246px left of this chip instead of under it. */}
        <PopoverContent
          align="start"
          container={portalContainer}
          className="accent-picker w-auto p-3"
        >
          <HexColorPicker color={customShown || "#c22727"} onChange={pickCustom} />
          {/* The picker's own 220px (vendor.css), so the row lines up with
           * the square above it. Left to size itself, the hex Input's
           * intrinsic width pushed the popover wider than the square and
           * left an empty strip down its right side. */}
          <div className="mt-3 flex w-[220px] items-center gap-2">
            {eyeDropper && (
              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label="Pick a color from the screen"
                title="Pick from screen"
                onClick={async () => {
                  try {
                    const { sRGBHex } = await new eyeDropper().open();
                    if (isValidHex(sRGBHex)) pickCustom(sRGBHex);
                  } catch {
                    /* cancelled with Escape: nothing to do */
                  }
                }}
              >
                <EyeDropperIcon />
              </Button>
            )}
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                #
              </span>
              <Input
                value={draft}
                aria-label="Hex color"
                spellCheck={false}
                maxLength={6}
                className="pl-6 font-mono uppercase"
                aria-invalid={draft.length > 0 && !isValidHex(`#${draft}`)}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^0-9a-f]/gi, "");
                  setDraft(next);
                  // Applied the moment it is a real colour, not on Enter:
                  // typing the sixth digit IS the commit.
                  if (isValidHex(`#${next}`)) pickCustom(`#${next}`);
                }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
