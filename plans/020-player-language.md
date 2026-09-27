# Plan 020: the player in the redesign's language

Adam, 2026-09-27, after the nav capsule: "would you say the player overlay
matches the new redesign we just did across the app?" It does not, and
"we should def do this". On the one limit (below): "its okay that we cant
blur".

## Where this sits

Plan 019 carried multi-view's language to the Guide, Stream, a film's
page, a series' page, Sports, Settings and the palette (its sections B to
H). The player was not one of them, and 019 held every screen's layout
still. So the player's controls are the kit's `Button` (plan 014) but its
look is the one from before: a flat row of bare `ghost` icons over the
bottom scrim, plain time text, a 5px rail. The top corners (Back, the
star, Pop out, Full screen) are already the kit's `chip` and stay.

Mockups: the real overlay on the `?overlay=1` seam over a drawn frame with
a bright lower third (the hard case for legibility), each option injected
as CSS over the real DOM. Today, A, B, B live, B with a menu open.

## The limit

Glass over the video cannot blur it. mpv draws into its own native window
under the page's clip hole, so `backdrop-filter` only ever sees the page
(019's risk note). Over a picture a control is the chip fill (`--chip-bg`,
rgb 20 at 0.6) and the hairline (`--chip-edge`), which is what the top
corners already wear. The bottom scrim stays under everything.

## What changes (option B)

**P1. Two capsules.** The two `.theater-controls__group`s become the
capsule over a picture: pill corners, 6px padding, chip fill and hairline,
the buttons inside bare with the kit's hover tint. Left: Back 10, Play,
Forward 10, Next episode (VOD) or the LIVE pill (live). Right: Sources,
Speed, Stats, Audio, Subtitles, Mute and the volume slider. Same order,
same sides as today.

**P2. Play is the white circle.** The kit's one primary is the white pill
(019); here it is the one control you reach for, so it takes it.

**P3. States by the kit's tint.** An open menu, Stats on: `--tint-on`,
replacing the hand-picked `bg-white/15`.

**P4. Times and LIVE as eyebrows.** 11px, 650, uppercase, tabular, the
on-image ink at 65% (`EYEBROW_ON_IMAGE`). The LIVE pill's word takes the
same type.

**P5. The rail.** 4px at white 20%, the fill stays the accent, a 12px
knob. Its mechanics (the `--pct` transform, the hit area, DVR) do not
change.

**P6. Menus.** Speed, Audio, Subtitles: the chip fill at 0.78 with the
hairline, 18px corners, the head as an eyebrow, the chosen item on a tint
pill as well as its check.

## What does not change

- The layout: logo, title and description over the rail, the rail over the
  two groups, left and right. The logo's ink trim (v0.10.20) and the
  loading screen (v0.10.21) are as they are.
- The top corners, the skip chip, the buffering pill, the stats panel, the
  dead card.
- The mini player. Its box is 320px wide and its two buttons already read
  as chips; it is its own question if it is one.
- Every behaviour: keys, the wheel, auto-hide, the scrub, DVR, menus
  closing on a click on the picture.
- Class names and aria-labels. Harnesses find the player by
  `.player__btn`, `.track-menu`, `.theater-tracks`, `.theater-live`,
  `.skip-chip`, `.theater-topright`, `.theater-bar__*` and the labels.

## Decisions

**D1. Capsules or chips.** A puts each control in its own round chip, like
multi-view's bar; B groups them in two capsules, like the nav. *Recommend
B*: the nav is what the app is recognised by, a row of ten separate
circles is busier than two shapes, and B is the same amount of work.

**D2. The rail's fill.** *Recommend keeping the accent.* It is the one
place the accent says "your position", and on a default install it is
near-white anyway.

**D3. The menus: restyle in place, or move them onto the kit's
DropdownMenu.** *Recommend in place.* They carry their own keyboard
handling, the per-show track memory and two harnesses' worth of checks
(overlay-tracks, track-prefs). Moving them is a refactor for no visible
gain; the paint is what is out of step.

**D4. Speed as a word.** "1×" stays a word in the capsule, not an icon.
*Recommend keeping it*: it is the only control whose state is a number,
and the number is the point.

## Build order

One change, frontend only: `player.css` for P1 to P6, `TheaterOverlay.tsx`
for the class swaps (`bg-white/15` to the tint, the eyebrow on the times).
Harness: a player section in verify-overlay-tracks (the capsules' fill and
edge, Play white, the times as eyebrows, a menu's head as an eyebrow and
its chosen item on a tint), plus the harnesses that open the player:
aniskip-chip, credits, cw-sources, mventry, overlay-tracks, resolve-cancel,
sports-pairing, sports-theater, track-prefs, vodlogo, watchdog.

## Risks

- **Legibility on a bright frame.** The capsules carry their own fill, so
  they hold up better than today's bare icons; the mockup's bright lower
  third is there to show it.
- **The Sports theater** puts the same chrome beside a 360px panel. The
  capsules are narrower than today's spread rows, so it gains room, but it
  gets checked (sports-theater).
