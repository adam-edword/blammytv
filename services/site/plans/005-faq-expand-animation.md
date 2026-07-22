# 005 — FAQ expand animation (+ optional card hover lift)

- **Status**: TODO
- **Commit**: c73cd2c
- **Severity**: Additive
- **Category**: Missed opportunity (§8) + Interruptibility (§4)
- **Estimated scope**: 1 file (`services/site/index.html`), ~30 lines JS + ~2 CSS
  (+ ~8 lines CSS for the optional hover lift)
- **Depends on**: 001 (optional hover-lift section uses `--ease-out`, `--dur-fast`)

## Problem

The FAQ uses native `<details>` (`services/site/index.html:734-763`). The chevron
rotates smoothly (`:470-471`, good), but the answer **teleports** in — native
`<details>` has no open/close animation, so the panel snaps to full height. That's
a visible jar on an otherwise polished page.

```css
/* services/site/index.html:470-471 — chevron already animates; content does not */
details.qa summary .chev { transition: transform .2s ease; flex: none; }
details.qa[open] summary .chev { transform: rotate(180deg); }
```

## Target

Animate the details' height open/closed with the Web Animations API, keeping the
element open while it animates. Cross-browser, no dependencies. Reduced-motion →
skip entirely (native snap). The chevron rotation is left as-is.

CSS — add `overflow: hidden` so the clipped height reads cleanly during animation:

```css
/* target — add to the details.qa rule (services/site/index.html:458) */
details.qa { /* …existing… */ overflow: hidden; }
```

JS — add as a new IIFE at the end of the `<script>` (after plan 003's block if
present, before `</script>`):

```js
// FAQ — animate <details> open/close height (native details snaps otherwise).
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || typeof Element.prototype.animate !== 'function') return;

  Array.prototype.forEach.call(document.querySelectorAll('details.qa'), function (el) {
    var summary = el.querySelector('summary');
    var anim = null;
    var EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';   // matches --ease-out

    function run(from, to, onFinish) {
      if (anim) anim.cancel();
      el.style.overflow = 'hidden';
      anim = el.animate({ height: [from + 'px', to + 'px'] },
        { duration: to > from ? 280 : 240, easing: EASE });
      anim.onfinish = function () {
        anim = null; el.style.height = ''; el.style.overflow = '';
        if (onFinish) onFinish();
      };
      anim.oncancel = function () { anim = null; };
    }

    summary.addEventListener('click', function (e) {
      e.preventDefault();               // we drive open/close ourselves
      var startH = el.offsetHeight;
      if (!el.open) {
        el.open = true;                 // reveal content to measure full height
        var full = el.offsetHeight;
        el.style.height = startH + 'px';
        requestAnimationFrame(function () { run(startH, full); });
      } else {
        var closedH = summary.offsetHeight;   // details has no padding of its own
        run(startH, closedH, function () { el.open = false; el.style.height = ''; });
      }
    });
  });
})();
```

## Repo conventions to follow

- ES5-style IIFE at the bottom of the inline `<script>` — match the hero slider
  (`services/site/index.html:814`) and feature cross-fade (`:854`), both of which
  read `matchMedia('(prefers-reduced-motion: reduce)')` and bail when reduced.
- Padding lives on `summary` and `p`, not on `details` (see the comment at
  `services/site/index.html:463`) — so the collapsed height equals
  `summary.offsetHeight`. The JS relies on this; don't move padding onto `details`.

## Steps

1. Add `overflow: hidden;` to the `details.qa` rule (`services/site/index.html:458-461`).
2. Add the FAQ IIFE from **Target** at the end of the `<script>` block.
3. Leave the chevron rules (`:470-471`) unchanged — they already animate correctly.

## Boundaries

- Do NOT move padding from `summary`/`p` onto `details` — it breaks the collapsed-
  height measurement.
- Do NOT convert `<details>`/`<summary>` to custom elements — keep native semantics
  (keyboard + accessibility come for free).
- Do NOT add dependencies.
- If the FAQ markup drifted since commit c73cd2c, STOP and report.

## Verification

- **Mechanical**: none (no build).
- **Feel check**:
  - Click a question → the answer **slides open** (~280ms) instead of snapping;
    click again → it slides closed (~240ms). The chevron still rotates.
  - Spam-click a question rapidly → it reverses smoothly from the current height
    (no jump-to-zero restart), because `anim.cancel()` retargets.
  - Keyboard: Tab to a summary, press Enter/Space → still toggles (animated).
  - DevTools → Animations at 10%: the panel height eases, content clipped by
    `overflow: hidden` — no double-exposed flash.
  - Emulate `prefers-reduced-motion: reduce` → clicking snaps open instantly
    (native behavior), no JS animation.
- **Done when**: FAQ answers slide open/closed, interruptibly, with reduced-motion
  falling back to the native snap.

---

## Optional add-on — card hover lift (missed opportunity D)

Low value, purely decorative: the 3 setup cards and 8 theme cards are static slabs.
A subtle desktop-only lift adds tactility. Include only if desired.

```css
/* target — add to the <style> block */
@media (hover: hover) and (pointer: fine) {
  .setup__card, .theme {
    transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  }
  .setup__card:hover { transform: translateY(-4px); }
  /* .theme's edge is an INSET ring (see :358-362) — preserve it, then add lift + shadow. */
  .theme:hover { transform: translateY(-4px); box-shadow: inset 0 0 0 1px var(--border), 0 14px 34px rgba(0,0,0,.4); }
}
```

- **Boundary**: keep the `inset 0 0 0 1px var(--border)` shadow in the `.theme:hover`
  rule or the card's edge ring disappears on hover.
- **Feel check**: hover a theme card → it lifts 4px with a soft shadow, edge ring
  intact; on touch, tapping does not leave it stuck lifted.
