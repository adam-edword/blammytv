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

## Tiers (Adam, 2026-11-08)

"we should make some 'tiers' of themes":
- **Tier 1:** colours only.
- **Tier 2:** colours, effects and fonts (Prism, Velvet, Lagoon, Frutiger
  Aero, Phosphor). The radius rule holds: no corner, shape or layout change.
- **Tier 3:** a full design overhaul, the OS themes (Snow Leopard, Vista,
  Classic, maybe Yosemite and a tier-3 Fluent). These may change corners,
  borders and bevels (Adam: "i think you can change corner radii on other os
  themes"). The layout still never moves ("yeah no layout moving").
The radius checks in verify-themes and themePack.test.ts stay for tiers 1
and 2; a tier-3 pack declares its tier and is exempt from the radius check
but not from a layout check (a card's box and position stay as Default's).

Classic (Windows 2000, from Adam's screenshot of XP's Classic look) is in
the mock: grey bevels, square corners, a navy title bar, Tahoma.

### Classic's chrome (Adam, 2026-11-08)

Tier 3 lets Classic restructure the header (Adam: "you can change the
layout or padding if it makes sense"). Settled in the mock:
- A thin top bar with the BlammyTV mark and name only.
- One toolbar row of flat icon-and-label buttons that raise on hover:
  Back, Forward | Live TV, Multi-View, Sports | Home (the mark) | Stream,
  Discover, Library ... Search, Settings on the right. The tab you're on is
  pressed in with the checkered fill. (Adam: "<live tv row | home | stream
  row>".)
- An address bar ("BlammyTV › Stream › Home") and a status bar along the
  bottom ("Ready", what's live, games on now, the clock).
- The chrome is solid grey, so pages scroll behind it; content starts lower.
- Discover's sub-nav becomes a second band under the toolbar ("Show:" a
  genre dropdown, Movies and Series toggle buttons), and the address bar
  turns into Discover's search field with a Go button: it shows where you
  are everywhere else and takes typing on Discover (Adam: "dope i like it").
- Two searches on Discover (Adam: "there is search in discover though"):
  the toolbar's button is "Go To (Ctrl+K)", the jump-anywhere palette;
  Discover's field is "Search" and searches the catalog only.
- REC, the recommender (Discover's sparkle; only with a TMDB key), is a
  "Find Something to Watch…" toggle button at the right of Discover's band.
  Its page is a Windows wizard: a navy side panel of posters, "What are you
  in the mood for?", the keyword field with Add, keyword chips as small
  raised tags, "Your pick" with poster and details, and Find Again / Watch
  Now / Close along the bottom. The drifting poster wall is off: the era was
  static.
- Ctrl+K is the Run box: a small grey dialog titled "Go To" with a navy
  title bar, an "Open:" field, a sunken list of results with navy
  selection, OK and Cancel.
- The other tier-3 themes follow the same idea in their era: Snow Leopard's
  palette is Spotlight (categories in a grey column on the left), Vista's is
  the Start menu's search. Tier 1 and 2 keep today's palette, restyled.

### Classic across the app (mocked 2026-11-08, Adam: "that's super epic")

In the same mock: a film's page as a Properties sheet with sources in an
Explorer Details list; a series as a seasons folder tree beside an episodes
Details list; the Guide as a channel-folder tree, a sunken preview with now
and next, and a grid with raised time and channel headers and a red now
line; Sports as a leagues tree, days as group boxes, away team first, the
score in a sunken green LED display; Discover's genres as raised buttons and
posters in Explorer's Thumbnails view; Settings as Display Properties
(property-sheet tabs, a Theme combo over a Sample box, radio buttons, square
swatches, checkboxes for toggles, one Close button because changes save as
you go). Its "?" button shows a yellow balloon tip ("Appearance Help: help
for these settings is in the BlammyTV docs, in your browser") with an "Open
Help in Browser" link; only the link leaves the app (Adam: "clicking the
question mark shouldn't automatically take you to the docs"). Multi-View follows the same parts and needs no mock.

### Classic's player (mocked 2026-11-08, reworked VLC-style)

Adam on the first, WMP-6.4 version: "the video is cropped waaaay too much
... more of a vlc-like layout ... way less cramped. we can lose the whole nav
bar and address too". So in the player: no app toolbar, address or status
bar. A thin grey strip on top with a VLC-style text menu ("◀ Guide /
Channel / Audio / Subtitles / View / Help", or "◀ Back / Playback / ..." for
a film) and the channel and programme on the right; black video edge to
edge, the picture ~91% of the height; a slim two-row Classic control bar
(seek row: "Started 7:00 PM ... LIVE" or elapsed, chapters and remaining;
button row: ⏪10, play, 10⏩, prev/next channel, Live, then Record, Audio,
Subtitles, Mini-Guide, Stats, Full Screen, and VLC's volume wedge with a
percentage). The mini-guide is a floating Classic tool window over the left
of the video (Channel / Now / Next) and never shrinks the picture.
Fading: in theater the menu strip and control bar stay, like VLC's window
(they sit outside the picture, so hiding them only leaves black bands and a
jump); in full screen the picture fills the screen and the same Classic
control bar floats over its bottom and fades after a few idle seconds, as
today, like VLC's full-screen controller. The mini-guide window stays until
closed or G.

## Fluent to tier 3 (Adam, 2026-11-08: "move it into a t3 theme ... to make it truly a fluent app")

Mocked in the same file (Fluent, both faces): BlammyTV as a Windows 11 WinUI
app. A custom title bar on the Mica with a centred search box that IS Ctrl+K
(results flyout grouped Channels / Films / Settings); a left NavigationView
(Home, Live TV, Multi-View, Sports | Stream, Discover, Library; Settings at
the foot; the selected item with WinUI's 3px accent pill); content on a
rounded 8px page layer; 4px controls, 8px cards; Settings as the Windows 11
Settings app (SettingsCards with the control on the right, ToggleSwitches);
Discover with a SelectorBar, a Genre ComboBox, its own page search and a
"Find Something to Watch" button; the player as Windows 11 Media Player
(video full under the title bar, a floating rounded acrylic transport bar).
Builds after Aero and Classic settle themePack's tier field.
Navigation (Adam: "maybe we have both, where the collapsible button in the
top left of pane makes it look like rail"): the full pane (Photos) by
default, and its hamburger collapses it to the Store's rail (icons with
small labels under them) and back, remembered. The page sits on a rounded
content layer, as the Store and Photos have it (Settings is the exception).
Fluent's Guide (Adam: the folder ComboBox "in the top right" was the wrong
UX): a folders column inside the page, WinUI's list/details (Mail's folder
list): a "Filter folders" box, Favorites, Recents, Recordings, All Channels,
then each source as a caption header ("My Playlist · 2 of 3 streams") with
its folders and channel counts; the selected folder has the accent pill.
The preview card and grid fill the rest. Mocked for Fluent's other screens
too: Home, Discover, Settings, Ctrl+K, Player, a film with its sources (a
ListView with quality badges, a Cached pill, filter pills and a sort), and
a series (a season SelectorBar over episode rows with thumbnails, watched
ticks and a progress bar).
Fluent's nav reads Home | Live TV, Multi-View, Sports | Stream, Discover,
Library ... Settings (a separator after Home too, Adam). Sports mirrors the
Guide: a leagues column (Filter leagues, Following, All Sports, sports as
caption headers with their leagues and today's counts) beside a day
SelectorBar and game cards three across, grouped Live Now / Later Today /
Final, the away team first, the loser dimmed on finals, status in accent
with a live dot, "Live on N channels" as a hyperlink button.

## Rule: the logo never changes (Adam, 2026-11-08)

"the logo is a box, the logo should never change no matter what." Every
theme, every tier, draws the BlammyTV mark with the app's own logo
component, same shape, colours and animation. Only its size may differ.
No theme paint (square corners, bevels, filters) may reach it.
