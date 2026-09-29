# 022: The glass, and light mode back

**Status: CALLS TAKEN (2026-09-29), not built yet.** Adam took all three
picks: glass B, the grey page (2), and the Appearance control. "I agree
with your picks. Gray looks really good and I like the glass hierarchy."
Next is the build order at the bottom. The options as rendered:
**https://claude.ai/artifact/Gae4pCKbpZp5qhfp5iFF8G** (private; 24
pictures, dark and light). Plan 014's "liquid glass" half and plan 016's
4.8 and 4.9 are this plan.

*Origin: the week of 2026-09-28, item 6: "the glass and the light pass, as
plan 022 with rendered options for Adam to pick". How the pictures were
made: each option is a stylesheet laid over the real app (v0.10.61, the
fake servers, a fixed clock, reduced motion), captured the way
`scripts/screens.mjs` captures. The CSS is below, exactly as rendered.*

## The rule every option keeps

From plan 014, which learned it the hard way:

- **Glass only where there is something behind it to see.** Over the
  near-black page it is grey frost; a solid surface is the honest answer.
- **Never over the video.** mpv is a native layer below the page and
  cannot be blurred. The theater's controls stay as plan 020 made them.
- **Never glass on glass.** What sits inside a glass surface is solid.
- **Solid again for `prefers-reduced-transparency`**, which the app
  honours nowhere today. Windows sets it from Settings → Accessibility →
  Visual effects → Transparency effects.

## Call 1: where the glass goes

| | What | Pick |
|---|---|---|
| **A** | Today: the capsule and the segmented tracks are a thin glass; menus, Ctrl+K and Settings are solid. | |
| **B** | Two tiers on the floating surfaces. Small floats (Ctrl+K, menus, popovers) are thin glass; Settings is thick glass, nearly solid, because a form over bright art needs its ground. The nav stays as today. | **yes** |
| **C** | B, and the nav as a material: the capsule and the two header buttons get a stronger blur, a lit top edge and a soft drop. | |

**Why B.** It puts glass where plan 014 said it earns its place and
nowhere it costs legibility. C reads richer in dark, but in light the
header's round buttons go see-through over the hero's text (scrolled
Stream, light), and the capsule is already glass today. A first draft of C
also dropped the header's scrim; the clock became unreadable over art, so
every option keeps it.

```css
/* B: small floats, thin glass. */
.mvpick.palette,
[data-slot="popover-content"], [data-slot="dropdown-menu-content"],
[data-slot="context-menu-content"] {
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: var(--glass-lift);
  border-color: color-mix(in srgb, var(--text) 12%, transparent);
}
/* B: the big panel, thick glass, nearly solid. */
.settings {
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: blur(40px) saturate(1.4);
  box-shadow: var(--glass-lift);
}
/* B: a lighter dim behind a dialog, so there is something to see. */
[data-slot="dialog-overlay"] { background: rgb(0 0 0 / 0.3); }

/* C adds: */
.navcap, .header__action {
  background: color-mix(in srgb, var(--bg) 45%, transparent);
  backdrop-filter: blur(24px) saturate(1.8);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text) 16%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--text) 9%, transparent),
    0 10px 30px rgb(0 0 0 / 0.28);
}
```

Built for real, these become tokens next to `--float-*` (`--glass-thin`,
`--glass-thick` and their blurs), not selectors with `!important`, and the
tooltip joins the thin tier (it already wears `--glass-lift`).

## Call 2: what light mode's page is

| | What | Pick |
|---|---|---|
| **1** | shadcn's own light: page and cards both white, told apart by hairlines. What the tokens say today. | |
| **2** | A grey page (oklch 0.965) with cards and panels white on it, tracks darker than the page. | **yes** |

**Why 2.** The app is cards: channel rows, game cards, posters. On a grey
page they read as objects at a glance; on white they are outlines. It is
also how the light palette worked before v0.9.57.

```css
:root[data-theme="light"] {
  --bg: oklch(0.965 0 0);
  --surface-track: oklch(0.93 0 0);
  --surface-puck: oklch(0.93 0 0);
  --sidebar: oklch(0.985 0 0);
}
```

## Call 3: how light is turned on

Settings → Customize → Interface, under Accent: **Appearance**, the same
segmented control as Startup Tab and Clock Format, with **Dark**, **Light**
and **Match Windows**. Match Windows follows `prefers-color-scheme` live
(WebView2 passes Windows' setting through). Dark stays the default, so
nothing changes for anyone until they pick. `main.tsx`'s forced dark
(plan 016 D1) comes out in the same commit, and the stored value it has
been leaving alone is read again.

## What the light pass fixes either way

Not choices: each is wrong in light today and right under either option
once fixed. From the renders and the week's colour pass (v0.10.60).

1. **Controls on a picture follow the theme.** On the Stream hero, More
   info vanishes in light and Watch now turns black. A control on a
   picture takes the picture's ink (`--on-image`, `--chip-*`) in both
   themes.
2. **White on the page that doesn't turn:** `.live-toast__msg` (white on
   the white toast), the 8% white fills behind `.list-picker__input` and
   `.rowcap__value--edit`, `.chip-beta`'s fill and ink, the
   `.guide__cell-shine` hover sheen, and `.mvnotice__icon`'s well. Each
   takes a `--text` mix (the `--tint-*` family) instead.
3. **The header's scrim is a white haze over a scrolled hero** in light.
   Over a picture it should be the picture's shade in both themes.
4. **The hero's coloured glow** reads as a pink smudge on white: dark-only,
   or much fainter in light.
5. **`.vod-detail__scrim`** fades to the old page colour (#0b0b0e), not
   to `--bg`.
6. **Dark names on the Sports rail** (the note in `main.tsx` from when
   light was switched off).

## Build order, once the calls are taken

1. The light fixes (above), each checked in light with
   `scripts/screens.mjs` and unchanged in dark (the sheet check proves
   the dark half).
2. The page tone (call 2) and the control (call 3), with a harness that
   switches the theme and checks the stored value boots.
3. The glass tiers as tokens (call 1), `prefers-reduced-transparency`
   turning every tier solid, and `verify-glass`: contrast measured over
   each tier in both themes, over the hero and over the plain page, and
   the reduced-transparency switch.
