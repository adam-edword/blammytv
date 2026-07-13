# 004 — Hero load entrance (staggered fade-up on first paint)

- **Status**: TODO
- **Commit**: c73cd2c
- **Severity**: Additive (delight budget)
- **Category**: Missed opportunity (§8) + Interruptibility (`@starting-style`, §4)
- **Estimated scope**: 1 file (`services/site/index.html`), ~18 lines CSS
- **Depends on**: 001 (uses `--ease-out`, `--dur-slow`)

## Problem

On first paint the hero renders fully formed — logo, wordmark, lede, CTAs, and the
coverflow slider all appear at once. The hero is the one rare, high-emotion,
first-impression moment that's allowed a little delight, and it currently gets none.

Relevant markup (`services/site/index.html:509-540`): `.hero__mark`, `.hero h1`,
`.hero .lede` (class `lede`), `.hero__cta`, `.hero__shots`.

## Target

Each hero element fades up 12px in sequence on load, using CSS `@starting-style`
so **no JS and no default-hidden state** are needed — the elements' normal state
is visible, and `@starting-style` only defines the first-render "from" state.
Browsers without `@starting-style` support simply show the hero instantly (graceful
degradation). Gated to `no-preference` so reduced-motion users get the static hero.

CSS to add to the `<style>` block:

```css
/* Hero load entrance — staggered fade-up on first paint (no JS).
 * @starting-style supplies the from-state only during initial render, so
 * unsupported browsers / reduced-motion just render the hero as-is. */
@media (prefers-reduced-motion: no-preference) {
  .hero__mark, .hero h1, .hero .lede, .hero__cta, .hero__shots {
    transition: opacity var(--dur-slow) var(--ease-out),
                transform var(--dur-slow) var(--ease-out);
  }
  @starting-style {
    .hero__mark, .hero h1, .hero .lede, .hero__cta, .hero__shots {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  /* Stagger the sequence. */
  .hero h1      { transition-delay: 60ms; }
  .hero .lede   { transition-delay: 120ms; }
  .hero__cta    { transition-delay: 180ms; }
  .hero__shots  { transition-delay: 240ms; }
}
```

## Repo conventions to follow

- Reduced-motion is expressed with media queries in the inline `<style>` — here we
  invert to `no-preference` so the effect is opt-in for motion-tolerant users
  (same guard style as plan 001's smooth-scroll gate).
- The hero elements are already position/z-index'd (`services/site/index.html:171-182`);
  this plan only adds `transition` / `transform` / `opacity` — no layout changes.
- `--dur-slow` (600ms) and `--ease-out` come from plan 001.

## Steps

1. Add the entire `@media (prefers-reduced-motion: no-preference) { … }` block from
   **Target** to the `<style>` block (place it after the `.hero__cta` rule around
   `services/site/index.html:179` for locality, though position doesn't matter).
2. Verify the selectors match the hero markup: `.hero__mark` (`:512`), `.hero h1`
   (`:513`), `.hero .lede` (`:515` — the `<p class="lede">`), `.hero__cta` (`:516`),
   `.hero__shots` (`:525`).
3. No JS and no markup changes.

## Boundaries

- Do NOT introduce a default-hidden state outside `@starting-style` — that would
  hang the hero invisible on unsupported browsers.
- Do NOT animate the whole `.hero` container (that would fade the background glow
  oddly) — only the five listed children.
- Do NOT touch the coverflow slider's own transitions (`:261-296`) or its JS.
- Do NOT add dependencies.
- If the hero markup drifted since commit c73cd2c, STOP and report.

## Verification

- **Mechanical**: none (no build).
- **Feel check** (use a Chromium ≥117 / Safari ≥17.5 / Firefox ≥129 build, where
  `@starting-style` is supported):
  - Hard-reload → logo, then wordmark, lede, CTAs, and slider rise ~12px and fade
    in over ~0.6s, each ~60ms after the previous. It should feel like a calm settle,
    not a bounce.
  - Navigate away and back (or reload) → it replays; it does NOT replay on in-page
    scroll (this is a load-only effect).
  - DevTools → Animations at 10% playback: confirm transform + opacity only.
  - Emulate `prefers-reduced-motion: reduce` and reload → hero appears instantly,
    fully formed.
  - In an engine without `@starting-style` (or toggle it off), the hero still shows
    correctly — just with no entrance.
- **Done when**: the hero performs a subtle staggered fade-up on load, and every
  fallback shows a correct static hero.
