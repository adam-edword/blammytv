# Plan 035: Themes, colour first

Status: DECIDED (2026-10-30, Adam), building. Canvas:
https://claude.ai/artifact/26deGFP4euFfJYkQeEkhcH

Adam: "i really like prism. but i think for the first few we should do
mostly just color changes".

## Decided

- **The first themes change colour only.** No fonts, corner radii, grain or
  shapes yet; those were the canvas's other half and can come later.
- **Three themes, plus the app as it is today ("Default"):**
  - **Prism:** neutral greys, a pink accent (#ff8bc9), and the brand's
    rainbow in three places it already glows: the focus ring, the Guide's
    now-line and the glow behind the Stream hero.
  - **Velvet:** oxblood surfaces and a brass accent (#e8bb6c), without its
    Bodoni type, its grain or its sharp corners.
  - **Lagoon:** deep teal and an aqua accent (#5fe1c1), opaque surfaces
    (its translucency and the page lit by the picture stay for later).
- **Signal is left out of this round.** It's a light theme whose identity is
  square corners and uppercase type, so it doesn't survive as colours only.
- Values are the canvas's tokens (project/Prism.dc.html and siblings), with
  every text tier checked for contrast on its surfaces (the canvas lists the
  lowest pairs, all above 4.5:1).

## Later

- **A Fluent Design theme** (Adam, 2026-10-30: "I want to make a fluent
  design theme"): Microsoft's Fluent look, after this colour-only round,
  since it reaches past colour (Mica and Acrylic materials, Segoe UI
  Variable, Fluent's corner radii and focus visuals).
- The rest of the canvas: Velvet's type and grain, Lagoon's translucency and
  picture light, Signal.

## Calls made here (Adam can overrule)

- **Dark only.** The three are dark palettes. In Light, the app keeps its own
  light look, and the Theme picker says so.
- **A theme brings its own accent.** While one is on, the Accent picker is
  hidden, so a theme looks as it was designed.
- **Free.** No Themes Pass gate in this round; the paid seam (old/themes,
  license.ts, services/keybox) stays parked until Adam decides.

## How

- Packs are overlays on the existing tokens under
  `:root[data-theme-pack="…"]`, with no default pack: no attribute is the
  base palette (old/themes/README.md is why).
- Settings → Appearance → Theme: Default, Prism, Velvet, Lagoon, as swatch
  cards. Stored like the other appearance settings, in Ctrl+K and the
  settings export; applied at boot before first paint, as the accent is.
- Prism's three rainbow spots are new hooks: a focus ring image, the
  now-line fill and the hero glow, each falling back to today's look.
