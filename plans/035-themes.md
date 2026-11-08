# Plan 035: Themes, colour first

Status: BUILT v1.0.37 (Prism, Velvet, Lagoon). Round 2 (1.3) BUILT
v1.2.2, below. Canvas:
https://claude.ai/artifact/26deGFP4euFfJYkQeEkhcH

Adam: "i really like prism. but i think for the first few we should do
mostly just color changes".

## Decided

- **The first themes change colour only.** No fonts, corner radii, grain or
  shapes yet; those were the canvas's other half and can come later.
- **Three themes, plus the app as it is today ("Default"):**
  - **Prism: the app in onboarding's look** (Adam, 2026-10-30, mockup
    https://claude.ai/artifact/KRZtmMwWTcVveQKokdVTBJ v7): true black, white
    type, a white accent, onboarding's dot dither behind the content, and its
    cursor glow (brighter, 0.16 at the centre) shining through the dots in
    the gaps between cards. The rainbow stays in the logo, the shelf glow,
    the Guide's now-line and the player's progress and LIVE dot. Rejected on
    the way: a rainbow focus ring, a rainbow nav pill (solid, then a 20%
    wash), a 640px glow. The dither and glow sit inside .app-shell so the
    player's clip hole cuts them; no glow under reduced motion or touch.
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
- **Accents per theme** (Adam): Prism takes none (its accent is white);
  Velvet and Lagoon show the picker, opening on their own accent, and each
  theme remembers its own choice.
- **The cursor light hides while any player hole is cut** (the Guide's
  preview as well as theater and fullscreen): the app has no theater flag,
  and the clip-path is the one signal every player shares.
- **The cursor light only animates while it moves**, so a still pointer
  costs no frames.
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

## Round 2, for 1.3 (decided 2026-11-03)

Adam: Fluent, Velvet full and Lagoon full, and "I don't want to edit the
corner radius of elements. I think the themes should still be Shadcn at the
core for now. We can experiment with more intense themes with actual
element changes later on". So a theme may change colour, type, texture,
light and transparency. It never changes a radius, a shape, a layout or a
component. Signal stays out (its identity is square corners).

- **Fluent** (new): Windows 11's look on shadcn's shapes.
  - Real Mica behind the app, through Tauri's window effects (tauri 2.11),
    on only while Fluent is on. The mpv child is sized to the video rect
    (inv.rs), so Mica shows wherever the page is see-through and no video
    is. Where Mica can't apply (Windows 10, or the call fails) the page
    keeps a solid Fluent base, #202020.
  - Segoe UI Variable (Display for headings, Text for the rest), a system
    font on Windows 11, so no new dependency; Segoe UI after it.
  - Fluent's dark tokens: layers as light washes over Mica, text at
    100/78.6/54.4% white, accent #60cdff (Windows' default dark accent),
    with the picker, like Velvet and Lagoon.
  - Fluent's focus visual: a 2px white outer ring over a 1px black inner.
- **Velvet, full:** Bodoni Moda headings and Figtree text (two fontsource
  packages, the canvas's choice), the film grain (a 160px tile at about
  15%), darkened picture corners and the footlight under the Stream hero.
  Not its sharp corners.
- **Lagoon, full:** see-through panels (the canvas's glass: blur 24px,
  saturate 1.6, an rgb(238 251 248 / 0.10) wash) and the page lit by the
  picture (`--page-ambient`: the hero art sampled into soft light behind
  the page). Opaque again under prefers-reduced-transparency.

### Calls made here (Adam can overrule)

- **Fluent is dark only**, like the others: Mica is forced dark. A light
  Fluent can follow if it's wanted.
- **Fluent's accent is Windows' default blue, not your Windows accent.**
  Reading the system accent is another native call; the picker covers it.
- **Lagoon's light comes from the hero art, not the live picture.** mpv
  draws natively, so the page can't sample the video.

## Round 3: Frutiger Aero (decided 2026-11-08)

Adam: "can you work on a frutiger aero theme? like the old apple/windows
bubbly theme". Mock: https://claude.ai/artifact/GKVDu66CSS3Hetg5U95c8c.

- **Both faces** (Adam picked it): Daylight when Appearance is Light (a summer
  sky to a green horizon, white glass, navy ink), Night when it is Dark
  (Windows 7 glass over a deep ocean with an aurora). The first pack that is
  not inert in Light.
- **All the effects** (Adam: "All of it!"): the gloss (a bright top half on
  buttons, the nav, chips and switches), bubbles drifting up behind
  everything, and the swoosh of light (by day) and aurora (by night).
- Still shadcn at core: no radius, shape or layout changes. The gloss is
  paint. Segoe UI, the font Vista and 7 used. Aqua accent with a green
  second colour, and the Accent picker.
- Calls made here: bubbles are a composited transform on one layer, still
  under reduced motion and hidden while a player hole is cut, as Prism's
  light is. Cards get the glass wash without a blur (Lagoon's reason).

## The rule for era themes (Adam, 2026-11-08)

"The theme should make the app feel like it's a part of that era/os. Like
styling the app to fit snow leopard or windows fluent etc." So a theme
dresses BlammyTV as an app of that system (its toolbars, controls,
selection, type, materials), not the system's wallpaper behind the app.
Mock of the next candidates (Snow Leopard, Yosemite, Phosphor):
https://claude.ai/artifact/9HwDXazCP9e3P4hGm7tsc4

## Next: Snow Leopard (Adam, 2026-11-08)

Built after Aero, on Aero's light-face mechanism. "Like Apple's apps"
(Adam: "I like the Apple app version better"): Light is iTunes 10 and the
Finder (a full-width grey toolbar band painted behind the header, white
page, white cards, blue Aqua gel on what's chosen); Dark is Front Row
(black, dark silver bars, Cover Flow reflections under posters). Lucida
Sans Unicode (built into Windows, Lucida Grande's twin). The band is paint
behind the header, not a layout change. Yosemite and Phosphor undecided.
