# Plan 031: the shelf hero

**Status: DECIDED, ready to build** (2026-10-27). Replaces Stream's hero
(StreamScreen.tsx `Hero`, the Figma 133-721 carousel) with Adam's mockup:
one 16:9 card in focus and the rest as 2:3 posters at its height, the
title's details under the card. Prototype, signed off by Adam as "feeling
great": https://claude.ai/artifact/Bd2wg64QRMyzLACydAKSbM (private; its
source is the Stream screen captured from this branch with only the hero
swapped).

## Why

- Continue Watching shows on first load. Today's hero is 80vh, so the row
  most people open Stream for is below the fold.
- It's the TV remote's shape: left and right grow the next card. Plan 030
  (Android TV, Fire TV) gets it for nothing.
- The text sits under the picture, on the page, so it reads on any art.

## Decided (Adam, 2026-10-27)

- **Replace, don't add a setting.** The old hero goes, with its tilt.
- **No buttons.** Clicking the focused card, or Enter on it, opens the
  title page (today's More Info). Clicking a poster slides it into focus.
  Watch Now leaves the front page.
- **Keep the glow, tighter, brighter, and all lit** (Adam, after the
  prototype). Today's shape stays: the shelf again, blurred, sliding in
  lockstep behind a box that stays put around the focused card and fades
  at its edges. The box now reaches 110px past the card's sides and 56px
  above and below (today 210 and 90), fading over 90px and 56px. The blur
  is 32px with saturate 1.9 and brightness 1.55 (today 70px and 1.4), and
  everything inside the box shines at 75% (today the centre at
  .7 and neighbours at .3).
- **The logo only fades.** It never moves or changes size: it is sized from
  the full card, not the growing one, and fades in once the card has grown.
- **No logo on the posters.** A poster already carries its title.
- **Click and drag** (Adam, the same day). The shelf follows the pointer;
  on release it settles on the nearest poster, and a flick moves at least
  one. A drag is never a click. Touch keeps vertical page scroll.

## The design (from the prototype; numbers are the mockup's)

Geometry, as shares of the window width:

- Focused card 43vw wide, 16:9 (so 24.2vw tall). Posters 16.25vw wide at
  the same height (2:3). Gap 1.6vw. The focused card sits 4.4vw from the
  left edge, and the previous card peeks in to its left.
- Under the card, at the card's left edge and no wider than it (max
  760px): the meta line, then the synopsis (max 720px).
  Meta uses the app's separator: "2008 · 100 min · Movie · ★ 7.6/10".
- The hero is as tall as its content, not the viewport.

Motion (620ms, cubic-bezier(.22, .8, .24, 1)):

- The track slides one poster-and-gap left; the outgoing card shrinks to
  poster width while the incoming one grows to 16:9.
- Each picture keeps its own size while its card resizes. The poster layer
  is poster-sized and anchored left; the 16:9 layer is full-card-sized.
  The card's width reveals or covers them. Scaling either to the moving box
  zoomed the poster and slid its printed title off the bottom (Adam caught
  it in the prototype).
- The poster lies over the 16:9 art and does the fading both ways. On the
  way in, the art under it shows at once. On the way out it stays until the
  card is poster-sized again, so no gap opens beside a shrinking poster.
- The logo fades in after 55% of the grow, at its final size and place:
  bottom-left, inside a box 46% × 34% of the FULL card, contained. A soft
  scrim (bottom 45%) fades with it.
- The meta and synopsis fade out and back in with the new title (220ms).
- Autoplay every 8s, as today. Paused under the pointer, with focus
  inside, and never under reduced motion, where every transition is off.
- Forward-only and never rewinding, as today (virtual index). Only the
  focused card is a tab stop; ← and → move while focus is in the hero.

## Missing art

- No 16:9 art: the poster over a blurred, darkened copy of itself, poster
  on the right. (The prototype's first version did this with real posters.)
- No poster: the 16:9 art cropped to the poster box.
- Neither: the surface colour and the title's first letter, as a row card
  does (`stream-card__mono`).
- No logo, or it fails to load: the title in type, today's `HeroTitle`
  fallback, with the same fade-only rule.

## Things to keep from today's hero

- Plan 022's "picture under the header": when scrolling takes the focused
  card under the header, the header takes the picture's ink. Same check,
  on the new card.
- The `animReady` guard: no slide from the width-0 layout on entering the
  tab, and resizes snap rather than glide.
- Mounting a card ahead of the frame so a slide never decodes an image
  mid-animation. The poster and the 16:9 art both load for the next card.
- Hero Slider Sources (Settings → Appearance → Stream) and the featured
  list's sources are unchanged: this is the view, not the data.

## A catch the prototype hid

The prototype was dark only, and drew the meta and synopsis with
`--on-image` (white). In the app they sit on the PAGE, not on a picture,
so they take the page's text tokens, or they vanish in the light theme.
Check both themes.

## Build (one batch, frontend only)

- `features/stream/StreamScreen.tsx`: `Hero` rewritten; `HeroTitle` kept
  for the fallback. `styles/stream.css`: the `.shero` rules replaced.
- Harnesses that read `.shero`: verify-stream, verify-glass, verify-kit,
  verify-signin, verify-xtvod. Their hero checks change with the design
  (the tilt's glare check goes; the "no tab stops on peeking slides" and
  "autoplay holds while focus is in the hero" checks stay, rewritten).
- New checks:
  - focused card 16:9, posters 2:3, all the same height;
  - the logo's box is the same size at two moments of a grow;
  - the poster layer's width doesn't change during a grow;
  - a poster click slides it into focus;
  - Enter or a click on the focused card opens the title page;
  - the meta and synopsis swap;
  - autoplay pauses under the pointer and with focus;
  - reduced motion has no transitions;
  - the meta is readable in light (computed colour isn't white on white).
- `screens.mjs`: the Stream scene changes on purpose; nothing else may.
- Gates as CLAUDE.md, plus a full board (the hero is on Stream's front
  page, which many harnesses pass through).

## Not in this plan

Discover's own hero (if any) and Library: untouched. A TV-remote focus
model beyond ← → (plan 030's job).
