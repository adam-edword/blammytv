# 014: shadcn/ui, and a layer of liquid glass

- **Status**: **DESIGN, and it argues against half of its own title.** Nothing
  is built. Read the recommendation before the phases; the phases assume it.
- **Severity**: LOW (nothing is broken)
- **Category**: app-wide / design system
- **Estimated scope**: depends entirely on which of the three options below is
  picked. One is a session. One is a month. One is a mistake.
- **Origin**: Adam, 2026-09-06: "id like to adopt shadcn's ui library for our
  app, with a subtle layer of liquid glass on top."

## The short version

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
| Runtime deps | React, `@tauri-apps/api`, `react-colorful`, `react-parallax-tilt`, seven fontsource faces. **No Tailwind. No Radix. No CVA.** |
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
