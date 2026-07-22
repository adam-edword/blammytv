# 003 — Scroll-reveal entrances (fade-up + stagger)

- **Status**: TODO
- **Commit**: c73cd2c
- **Severity**: Additive (flagship feel win)
- **Category**: Missed opportunity (§8) + Cohesion/stagger (§7)
- **Estimated scope**: 1 file (`services/site/index.html`), ~10 lines CSS + ~30 lines JS
- **Depends on**: 001 (uses `--ease-out`, `--dur-slow`)

## Problem

The entire page paints statically — sections, the 3 setup cards, the 4 feature
rows, the 8 theme cards, the pass, the download card, and the FAQ items all just
*appear*. For a premium marketing page this is the single biggest missed
opportunity: a gentle fade-up as content scrolls into view makes the page feel
alive. There is currently no scroll-triggered motion anywhere in
`services/site/index.html`.

## Target

Content lifts 16px and fades in as it enters the viewport, with a 60ms stagger
between siblings in a group. **Progressive enhancement**: the hidden start state
is applied *by JS only*, so with no-JS, an unsupported browser, or reduced-motion,
everything renders normally visible (no flash-of-invisible-content).

CSS to add (near the other section rules in the `<style>` block):

```css
/* Scroll-reveal — JS adds .reveal (hidden) then .reveal.in (shown). */
.reveal { opacity: 0; transform: translateY(16px);
  transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out); }
.reveal.in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
}
```

JS to add as a new IIFE at the end of the existing `<script>` (after the feature
cross-fade block, before `</script>`):

```js
// Scroll-reveal — fade-up + per-group stagger as elements enter the viewport.
// Hidden state is applied here (not in static CSS), so no-JS / reduced-motion /
// old browsers just show everything.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  var SELECTOR = '.setup__card, .feature, .theme, .pass, .download__card, details.qa';
  var targets = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));

  targets.forEach(function (el) {
    el.classList.add('reveal');
    // Stagger by position among same-type siblings (capped so late items
    // don't wait too long). Non-grouped items (index 0) get no delay.
    var sibs = Array.prototype.slice.call(el.parentNode.children)
      .filter(function (c) { return c.className === el.className || c.classList.contains('reveal'); });
    var idx = sibs.indexOf(el);
    if (idx > 0) el.style.transitionDelay = Math.min(idx, 6) * 60 + 'ms';
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

  targets.forEach(function (el) { io.observe(el); });
})();
```

## Repo conventions to follow

- JS is plain ES5-style IIFEs at the bottom of the one inline `<script>`
  (`services/site/index.html:800-877`). Match that style — `var`,
  `Array.prototype.slice.call`, no arrow functions, no dependencies. See the hero
  slider IIFE (`:814`) and feature cross-fade IIFE (`:854`) as exemplars, both of
  which already read `matchMedia('(prefers-reduced-motion: reduce)')`.
- Reduced-motion CSS uses a bare `@media (prefers-reduced-motion: reduce)` block
  (exemplar `:218`).

## Steps

1. Add the three CSS rules from **Target** to the `<style>` block (a good home is
   right after the `.page` rule near `services/site/index.html:93`, or anywhere in
   the block — order doesn't matter).
2. Add the scroll-reveal IIFE from **Target** at the end of the `<script>`, after
   the feature-showcase IIFE that ends at `services/site/index.html:876`.
3. Do not add a `.reveal` class to any markup — the JS applies it. This keeps the
   no-JS/reduced-motion fallback safe.

## Boundaries

- Do NOT put the hidden `opacity:0` state in static CSS without the JS toggle —
  that risks content staying invisible if JS fails. The `.reveal` class must be
  JS-applied.
- Do NOT reveal the hero (`.hero`) — its entrance is plan 004. Do NOT reveal nav
  or footer chrome.
- Do NOT change existing markup or the two existing carousels.
- Do NOT add dependencies.
- If the `<script>` structure drifted since commit c73cd2c, STOP and report.

## Verification

- **Mechanical**: none (no build).
- **Feel check**:
  - Hard-reload at the top, scroll down slowly → each section's cards fade up from
    +16px as they enter; grid siblings (setup cards, theme cards) stagger ~60ms
    apart rather than popping together.
  - Elements already on-screen at load reveal immediately (don't wait for a scroll).
  - Scroll back up and down again → revealed items stay put (they don't re-hide;
    `unobserve` fires once).
  - In DevTools → Animations at 10% playback, confirm the motion is transform +
    opacity only (no layout jank).
  - Enable "Emulate prefers-reduced-motion: reduce" and hard-reload → **everything
    is visible immediately**, no fade, no hidden content.
  - Disable JS and reload → everything visible (no blank sections).
- **Done when**: content fades up on scroll with a subtle stagger, and every
  fallback path (reduced-motion, no-JS) shows the full page.
