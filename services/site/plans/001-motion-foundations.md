# 001 — Motion foundations: easing/duration tokens + reduced-motion scroll

- **Status**: TODO
- **Commit**: c73cd2c
- **Severity**: LOW (foundation — do this first)
- **Category**: Cohesion & tokens (#5) + Accessibility (#2)
- **Estimated scope**: 1 file (`services/site/index.html`), ~12 lines added/changed

## Problem

**A. No motion tokens.** The `:root` block holds design tokens (colors, fonts,
radius) but none for motion, so every duration/easing is hand-typed inline and
inconsistent: `.12s ease`, `250ms ease`, `.7s cubic-bezier(.4,0,.2,1)`,
`.2s ease`, `1.2s ease`, `.6s ease`, `.3s ease`. New motion (plans 002–005) needs
a shared vocabulary to stay consistent.

```css
/* services/site/index.html:28 — current :root, motion tokens absent */
:root {
  --bg: #0b0b0e;
  /* …colors, fonts, --radius: 35px, --brand… (no --ease-* / --dur-*) */
}
```

**B. `scroll-behavior: smooth` is not reduced-motion gated.** The anchor nav
(Features / Themes / Pricing / Download / FAQ) triggers a smooth scroll for every
user, including those who set `prefers-reduced-motion: reduce` — a documented
vestibular-discomfort trigger.

```css
/* services/site/index.html:68 — current */
html { scroll-behavior: smooth; background: var(--bg); overflow-x: clip; }
```

## Target

**A.** Add motion tokens at the end of the `:root` block (values copied exactly
from the audit playbook — do not approximate):

```css
/* target — append inside :root, before its closing brace on line 58 */
/* Motion — shared easings + durations (consumed by plans 002–005). */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--dur-fast: 150ms;
--dur-base: 250ms;
--dur-slow: 600ms;
```

**B.** Remove `scroll-behavior: smooth` from the base `html` rule and re-add it
behind a `no-preference` guard:

```css
/* target — line 68 becomes: */
html { background: var(--bg); overflow-x: clip; }

/* target — add immediately after the html rule */
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}
```

## Repo conventions to follow

- Tokens live in the single `:root { … }` block at `services/site/index.html:28-58`.
  Add the new custom properties there, alongside the existing `--radius`, `--brand`, etc.
- Reduced-motion is already handled elsewhere with plain media queries — see the
  exemplar at `services/site/index.html:218`
  (`@media (prefers-reduced-motion: reduce) { .browser__slides > img { transition: none; } }`)
  and `:294`. Match that style (a bare `@media` block in the `<style>`).
- This is a single self-contained HTML file: all CSS is inline in `<head><style>`.

## Steps

1. In `:root` (ends at `services/site/index.html:58`), just before the closing
   `}`, paste the five motion tokens from **Target A**.
2. Edit `services/site/index.html:68`: delete `scroll-behavior: smooth; ` so the
   rule reads `html { background: var(--bg); overflow-x: clip; }`.
3. Directly below that `html { … }` rule, add the `@media (prefers-reduced-motion:
   no-preference)` block from **Target B**.
4. Do NOT rewire the seven existing inline easings/durations to the new tokens in
   this plan — several use curves that don't exactly match a token (e.g. the hero
   slider's `cubic-bezier(.4,0,.2,1)`), and swapping them would silently change
   feel. Migrating existing values is deliberately out of scope here.

## Boundaries

- Do NOT touch any existing `transition:` declarations — this plan only *adds*
  tokens and gates smooth scroll.
- Do NOT change markup/structure.
- Do NOT add dependencies.
- If line 68 no longer matches the excerpt (drift since commit c73cd2c), STOP and report.

## Verification

- **Mechanical**: none required (no build). Optionally, `docker build -t site .`
  in `services/site` still succeeds.
- **Feel check**:
  - Load the site; scrolling and layout are visually **unchanged** (tokens are
    defined but not yet consumed here).
  - Click a nav anchor (e.g. "FAQ") with normal settings → page still smooth-scrolls.
  - In DevTools → Rendering → enable "Emulate prefers-reduced-motion: reduce",
    click a nav anchor → the jump is now **instant** (no smooth scroll).
- **Done when**: the five `--ease-*`/`--dur-*` tokens exist in `:root`, and smooth
  scroll is active only under `no-preference`.
