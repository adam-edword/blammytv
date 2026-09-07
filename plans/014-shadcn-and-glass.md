# 014: shadcn/ui, and a layer of liquid glass

- **Status**: **DECIDED AGAINST THIS PLAN'S OWN RECOMMENDATION, and the
  foundation shipped in v0.9.49.** Tailwind v4, shadcn's CLI and five
  generated components are in. The glass is still to do.
- **Severity**: LOW (nothing is broken)
- **Category**: app-wide / design system
- **Origin**: Adam, 2026-09-06: "id like to adopt shadcn's ui library for our
  app, with a subtle layer of liquid glass on top."

## The decision, and it is not the recommendation below

This plan recommended NOT adopting shadcn, and Adam overruled it the same
day: *"nope lets get tailwind in here"*, then *"this might be a pretty
intense overhaul and thats okay. i think shadcn's polish would really help
sell this app."*

**That is the call, and the rest of this file is kept as the cost accounting
rather than as an argument.** Everything in "Why not shadcn" is still true
and still the work: 13,828 lines of CSS to migrate, 105 harness selectors
that will need `data-testid`, and a component registry that does not draw a
`GameCard`. Keeping it written down is what makes the next session able to
see the size of the thing rather than rediscover it.

### What v0.9.49 actually shipped

The foundation, and only the foundation. No existing screen was restyled.

- **Tailwind v4** via `@tailwindcss/vite`, entered through `styles/index.css`,
  which is now the single stylesheet and the file that decides the cascade.
- **A cascade layer order**: `theme, base, app, components, utilities`. The
  app's fourteen sheets moved into `@layer app` so that a utility can
  override them, which is the whole point of having utilities. Their relative
  order and specificity among themselves are untouched.
- **Preflight is declared but NOT loaded.** It is a reset that would zero
  every margin and border, flatten `h1`-`h6` and make `img`/`svg`/`video`
  `display: block`. All questions `base.css` answered differently on
  purpose. The slot is held so switching it on later is one import rather
  than a re-sort, and switching it on is its own change with its own
  screenshot pass.
- **A token bridge** (`styles/theme.css`) republishing the app's palette into
  Tailwind's `--color-*` namespace, so shadcn's fifteen semantic names reach
  the real colours. `@theme inline` throughout, which is what keeps the
  runtime-picked accent working.
- **`styles/vendor.css`, deliberately unlayered.** react-colorful injects its
  stylesheet from JS at runtime, unlayered, and unlayered beats every layer
  whatever the specificity. The app's overrides of it had to leave the layer
  or the accent picker would have silently reverted to the library's look.
- **`scripts/verify-tailwind.mjs`**, 8 checks, because none of the above
  renders anything and so none of it fails loudly.

### The name collision worth knowing about

`accent` means two different things now. To this app it is the brand colour,
user-picked at runtime. To shadcn it is the quiet hover background behind a
menu row. `--color-accent` is mapped to the app's raised surface and
`--color-primary` to the brand, which is the correct reading of each system's
own word. Getting it backwards paints every dropdown row brand-red on hover
and looks deliberate.

## The original recommendation, kept as the cost accounting

**Adopting shadcn/ui is the wrong call for this app, and the reason is not
taste.** shadcn is a Tailwind adoption wearing a component-library costume,
and the cost lands on things this repo is actually built around. What is
worth taking is the half of shadcn that is not shadcn: **Radix primitives,
unstyled, without Tailwind.**

**The liquid glass is a separate and better idea**, it does not need shadcn
at all, and the app is already most of the way to it. The thing standing in
its way is a background problem, not a CSS problem.

## What is actually here

Measured 2026-09-06, not estimated.

| | |
|---|---|
| Hand-written CSS | **13,828 lines** across 14 stylesheets, `sports.css` alone 3,899 |
| React components | 50 `.tsx` files |
| Existing UI primitives | 5 (`ChipTabs`, `ModeRail`, `NameField`, `QualityBadge`, `Toggle`) plus the icon set |
| Design tokens | `tokens.css` (295 lines), Figma-derived, with node ids cited |
| Themes | `themes.css` (625) + `intense-packs.css` (499) |
| `backdrop-filter` uses | **71**, plus a `--float-blur` / `--float-bg` / `--float-shadow` recipe already tokenised |
| Runtime deps, BEFORE v0.9.49 | React, `@tauri-apps/api`, `react-colorful`, `react-parallax-tilt`, seven fontsource faces. **No Tailwind. No Radix. No CVA.** |
| Harness selectors | **105 unique semantic class names, across 296 selector calls** in `scripts/verify-*.mjs` |

That last row is the one that decides this.

## Why not shadcn

### 1. It is a Tailwind adoption, and Tailwind is not optional

Confirmed against the current install docs: shadcn/ui on Vite requires
Tailwind (v4, via `@tailwindcss/vite`), path aliases, and pulls in Radix,
`class-variance-authority`, `clsx`, `tailwind-merge` and `lucide-react`. There
is no supported no-Tailwind path. So "adopt shadcn" means "adopt Tailwind",
and then one of two things happens:

- **Rewrite 13,828 lines of CSS as utilities.** Months, and it throws away
  every comment in them. Those comments are the reasoning: why the lead is
  96px, why the row's trailing padding is `max(28px, calc(100% - 783.84px - var(--sports-lead)))`,
  why three blades land on x 8.9 and 15.1. That is the expensive part of this
  codebase and it does not survive the translation.
- **Run both forever.** Tailwind for new work, BEM-ish CSS for old. Two
  systems, two mental models, and every future component starts with a
  question about which one it belongs to. This is the likely outcome and it
  is the worst of the three.

### 2. It would break the verification suite

**105 unique class selectors across 296 calls.** `verify-sports-days` reads
`.compactcard` versus `.upcard` to tell a pill from a card. `verify-discover`
runs 63 checks off semantic names. Utility classes have no semantic name to
select, so every one of those becomes a `data-testid` migration done by hand
against 25 harnesses.

CLAUDE.md treats that board as the safety net, and this repo has already been
burned by harnesses rotting silently. Trading it for a styling change is the
wrong direction.

### 3. shadcn solves a problem this app does not have

Its pitch is "you have no design system, here is a good default." BlammyTV
has one: Figma-derived tokens with the source node ids in the comments, a
documented house voice, seven custom faces, themable intense packs, and a
different card per sport because each sport needs a different card.

And the surface area does not map. shadcn ships Button, Dialog, Select, Tabs,
Popover, Tooltip, Command. The app is `GameCard`, `WideRaceCard`, `GolfCard`,
`TournamentDraw`, the EPG guide, the theater, the boot sequence. Nothing in
the registry draws any of those, so the library would style the 10% that is
already fine and leave the 90% that is the app.

### 4. It is the thing CLAUDE.md names

> Simplest vanilla tech wins: no framework-of-the-month, no clever
> abstractions for hypothetical reuse.

Worth saying plainly rather than pretending the agreement is silent on it.

## What IS worth taking: Radix, on its own

**18 files hand-roll overlay behaviour** (`role="dialog"`, `aria-modal`,
Escape handling, focus restoration, `createPortal`), and 7 use portals
directly: both settings modals, `HeroSourcesSection`, `LiveScreen`,
`SaveButton`, `StreamScreen`, `SportsTheater`. There is a `lib/modalOpen.ts`
that exists because this problem is real and app-wide.

That is the genuinely hard, genuinely bug-prone part, and it is the part
shadcn is only a wrapper around. **Radix primitives are unstyled.** They ship
behaviour and ARIA and nothing else, they take a `className`, and they compose
with the CSS that is already here. No Tailwind, no rewrite, no harness churn:
the existing class names stay on the elements.

Take `@radix-ui/react-dialog`, `-popover`, `-dropdown-menu`, `-tooltip` as
four small dependencies. Skip the rest until something needs it.

## The liquid glass

This is the good half of the ask and it does not depend on anything above.

### The architecture is already right

`.header` is `position: absolute` with `pointer-events: none` and a scrim,
and its comment says the intent out loud: *"The nav floats over the tabs so
scrolling content can pass behind it."* Tabs offset themselves by
`var(--header-h)`, published from the header's measured height. That is
exactly the arrangement Apple's material guidance asks for: a translucent
layer with content moving under it, not an opaque bar eating a strip.

### The previous attempt, and what it actually found

Two experiments are parked in `base.css:164-264` and they are the most useful
thing in this plan.

The nav's glass fill is commented out with a reason: *"Temporarily bare — the
glass tint reads as frost even over the plain background."* And a seven-layer
progressive blur sits below it, disabled: *"Never matched the mock's feel."*

**Both failures are the same failure, and it is not a CSS bug. Glass needs
something behind it to refract.** Over `--bg: #050505` there is nothing to
blur, so `backdrop-filter` returns near-black, the white tint sits on top
unmixed, and the result is grey frost. The mock had a photograph behind it.

So the work is about what is BEHIND the glass. Any plan that starts by tuning
blur radii is going to re-walk the exact dead end already recorded here.

### The rule that follows

**Glass goes where there is content to see through it, and nowhere else.**

- **Earns it**: Discover and Stream (posters scroll under the nav), the
  theater's side column (video behind it), the guide over a tuned channel,
  any modal over a populated screen.
- **Does not**: the Sports board's near-black field, Settings' flat panels,
  the boot screen. On those, glass is grey frost and a solid `--surface` is
  the honest answer.

That is a rule the app can hold, and it is more useful than a global opacity.

### What to build, concretely

1. **Extend the token recipe rather than inventing one.** `--float-bg`,
   `--float-border`, `--float-blur`, `--float-shadow` already exist and are
   already documented as a deliberate set. Add weights to it rather than a
   parallel system: Apple's guidance is that bigger surfaces read as thicker
   (stronger blur, deeper shadow) and small chips read as lighter, so this
   wants two or three tiers, not one value.
2. **Never stack glass on glass.** Legibility collapses, and this app has
   real stacking (a popover inside a modal over the theater). The tier system
   has to encode "the parent is already glass, so this child is solid."
3. **A bright top edge.** `inset 0 1px 0 rgba(255,255,255,0.1)` is already in
   `--float-shadow`, which is the light-catching edge that makes a surface
   read as material rather than as a translucent rectangle. Keep it, and make
   it stronger on the thicker tier.
4. **Scroll edge effects instead of the 1px divider**, where floating chrome
   actually overlaps content. The header's existing `to bottom` scrim is the
   first version of this.
5. **Materialize, do not fade.** Animate blur radius and scale together on
   enter, so a panel arrives as a material rather than as an opacity ramp.
6. **`prefers-reduced-transparency`**, which the app honours nowhere today:
   raise the background opacity and drop the blur. `REDUCED_MOTION` already
   exists in `lib/` as the pattern to copy. This is not optional polish; it is
   the accessibility half of the feature.
7. **Re-measure light mode.** `themes.css` already carries a note about the
   glass shell and a solid fallback for live video. Every tier needs checking
   in both themes, and plan 010 #47 is the precedent for that going wrong
   quietly.

### The one real risk

**mpv is a native surface below the page and cannot be composited with.**
`base.css:166` says so: *"mpv video never sits under the nav, so
backdrop-filter is safe here."* Any glass introduced over the player will show
the page's background, not the video, and there is no CSS that fixes it. The
theater's own comment about fullscreen makes the same point. So the theater is
the one screen where the glass tier has to be chosen against where the video
actually is, not where the layout suggests.

## The build order: GROUND UP, by primitive

**Decided 2026-09-07.** Adam, on the screen-by-screen phasing this file used
to carry: *"i feel like building by screen would still drift and get muddy.
pretty much every screen shares some assets with another."*

He is right, and the coupling is measurable:

| Shared thing | Reached by |
|---|---|
| `ui/icons.tsx` | **20 files**, 5 features |
| `.toggle` | 6 features |
| `.btn-primary` | 4 features (16 uses) |
| `.header` | 5 features |
| **`RowScroller`** | discover, library, **sports** — while living inside `StreamScreen.tsx` |

That last row is the proof. "Rebuild the Stream screen" silently rebuilds
part of Sports and Discover, because a shared primitive lives in a screen
file. There is no screen that can be finished in isolation, so the screen is
the wrong unit.

**The unit is the primitive, and the order is the dependency graph.**

- **L0, foundation** *(shipped v0.9.49-52)*: tokens, the theme bridge, the
  cascade order, the radius scale.
- **L1, primitives**: the focus ring *(v0.9.53)*, then Button, Input, Label,
  Select, Switch, Badge, Separator, ScrollArea, Dialog. ChipTabs and Toggle
  take shadcn's surface and keep their thumb (see the constraint below).
- **L2, shared chrome**: header, nav capsule, app shell. And **move
  `RowScroller` and `Card` out of `StreamScreen.tsx` into `ui/`**, because a
  screen exporting primitives is the structural cause of the muddiness.
- **L3, screens**, which by then are mostly composition: Settings first
  (nothing depends on it), then Live, then Stream/Discover/Library, Sports
  last because its cards are the most bespoke thing in the app.

**Not as a big-bang branch.** With 26 harnesses that means weeks of red and
no way to tell a real break from an unfinished one, and this migration has
already produced two silent breaks that only a green board caught (the black
video in v0.9.51, and a regex that ate a closing brace in v0.9.52). Each new
primitive is built ALONGSIDE the old one, consumers move one at a time, and
the old goes when the last consumer does.

**Preflight is not needed for any of it**, which removes the scariest part.
Measured 2026-09-07 by turning it on and reading the geometry: headings,
SVGs and buttons are all unchanged, because base.css already answers every
question Preflight answers. Its only net effect is `line-height: normal` to
`1.5`, which re-flows spacing app-wide for no gain.

## Adam's constraint: the thumb stays

**Decided 2026-09-06, mid-migration.** shadcn's pill-group *styling* is
welcome; its *behaviour* is not a replacement for what is here.

`ChipTabs` (`ui/ChipTabs.tsx`, `.chip-tabs__thumb` in `ui.css:40`) animates
one raised thumb between segments, re-measuring on content change, with a
reduced-motion guard at `ui.css:166`. `Toggle` does the same at a smaller
scale (`.toggle__thumb`, `ui.css:106`). shadcn's Tabs and ToggleGroup do not
have this: they restyle the active item in place, and swapping to them would
trade a continuous, interruptible movement for a state change.

So the rule for these two components is **take the surface, keep the
mechanism**. Radix Tabs can supply the roving focus and ARIA underneath;
`chip-tabs__thumb` and its measuring effect stay. Anything that would delete
the thumb is out of scope regardless of how much markup it saves.

## Three options, and what each costs

| | Work | Buys | Costs |
|---|---|---|---|
| **A. Radix + a glass materials pass** (recommended) | ~2 sessions | Real a11y on 18 files, the glass, no design churn | Nothing structural |
| **B. Full shadcn + Tailwind** | Weeks, realistically a month | A component registry the app mostly cannot use | 13.8k lines rewritten, 105 harness selectors migrated, every comment lost |
| **C. shadcn alongside the existing CSS** | Days to start, forever to live with | New screens get faster to build | Two styling systems permanently. The one to avoid |

If the pull toward shadcn is really about its **look** rather than its
components, say so and that is a different plan: a restyle of the existing
tokens toward that aesthetic, which is a day of work in `tokens.css` and needs
no dependencies at all.

## Phases, for option A

1. **Radix behind the existing markup.** One component first, `SettingsModal`,
   keeping every class name so the harnesses keep passing. Prove the pattern,
   then move the other six portal users. `lib/modalOpen.ts` should shrink or
   go.
2. **The glass tier tokens**, in `tokens.css`, next to `--float-*`, with the
   "glass needs a backdrop" rule written into the comment so the parked
   experiments are not re-walked.
3. **Apply per screen, judged per screen**, starting with Discover, where
   there are posters behind the nav and the treatment can actually be seen.
   Re-enable the nav fill there and only there.
4. **`prefers-reduced-transparency` and the light-mode pass**, together,
   because they are the same audit.

## Verification

- Every existing harness keeps passing on its current selectors. That is the
  gate for phase 1, and it is what makes a Radix swap provable rather than
  hopeful.
- A new `verify-glass.mjs` on the model of `verify-themes.mjs` (18 checks) and
  `verify-intense-themes.mjs` (31): assert the tier a surface resolves to on
  each screen, in both themes, and that
  `prefers-reduced-transparency: reduce` drops the blur. Playwright can
  emulate that media feature.
- Contrast re-measured over the glass tiers in both themes. Plan 010 #47
  found four failures that a theme flip left behind, and glass is a harder
  case than a flat surface.
