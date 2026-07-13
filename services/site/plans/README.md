# Animation plans — BlammyTV site

Prioritized motion improvements for `services/site/index.html`, produced by the
`improve-animations` audit at commit `c73cd2c`. Each plan is self-contained: exact
file, current code, target values, steps, and a feel-check. Motion is currently
well-built (no HIGH findings) — these are polish + additive delight.

| # | Plan | Severity | Depends on | Status |
|---|------|----------|-----------|--------|
| 001 | [Motion foundations: tokens + reduced-motion scroll](001-motion-foundations.md) | LOW (foundation) | — | TODO |
| 002 | [Interactive feel: button press, hover gating, live link hovers](002-interactive-feel.md) | MEDIUM / LOW | 001 | TODO |
| 003 | [Scroll-reveal entrances (fade-up + stagger)](003-scroll-reveal-entrances.md) | Additive (flagship) | 001 | TODO |
| 004 | [Hero load entrance (staggered fade-up)](004-hero-load-entrance.md) | Additive | 001 | TODO |
| 005 | [FAQ expand animation (+ optional card hover lift)](005-faq-expand-animation.md) | Additive | 001 (optional add-on) | TODO |

## Recommended execution order

1. **001 first** — it defines the `--ease-*` / `--dur-*` tokens that 002–005
   reference, and gates smooth scroll for reduced motion. Do not skip it.
2. **002** — cheapest visible win; fixes the (currently dead) nav-link hover and
   adds CTA press feedback.
3. **003** — the flagship; biggest single feel upgrade.
4. **004** and **005** — independent additive polish, either order.

## Dependencies

- 002, 003, 004 all consume tokens from **001**; land 001 before them.
- 003 (scroll reveals) explicitly excludes the hero, which **004** owns — no overlap.
- 003 and 005 each append a JS IIFE to the same `<script>`; if executed
  separately, add each block at the end without disturbing the other.

## Scope notes / what was deliberately left alone

- The hero-slider curve, the feature cross-fade's asymmetric slow-out/quick-in
  timing (documented, prevents a black flash), and the nav's one-shot
  backdrop-filter transition were audited and judged **by-design** — not changed.
- Plan 001 does **not** migrate the seven existing inline easings to tokens
  (several curves don't map exactly and swapping would change feel).

## Executing a plan

These are written for any executor (including a cheaper model) with zero context.
Hand one over as-is, e.g. `improve-animations execute 003-scroll-reveal-entrances.md`,
or implement it directly. Each plan's **Verification** section is mandatory —
motion can be mechanically correct and still feel wrong.
