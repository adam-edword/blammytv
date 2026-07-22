# 002 — Interactive feel: button press, touch-gated hover, live link hovers

- **Status**: TODO
- **Commit**: c73cd2c
- **Severity**: MEDIUM (press feedback) + LOW (hover polish)
- **Category**: Physicality (#1), Accessibility (#4), Easing/Cohesion (#3)
- **Estimated scope**: 1 file (`services/site/index.html`), ~15 lines
- **Depends on**: 001 (uses `--ease-out`, `--dur-fast`)

## Problem

**A. Buttons have no press feedback.** The primary CTAs (Download ×2, Features,
Pricing) lift on hover but nothing happens on `:active` — a press should feel
physical.

```css
/* services/site/index.html:105-111 — current */
.btn {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: var(--font-h); font-weight: 700; font-size: 18px;
  padding: 12px 20px; border-radius: var(--radius); cursor: pointer; border: 0;
  transition: transform .12s ease, filter .12s ease;
}
.btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
```

**B. The hover lift fires on touch.** `.btn:hover { transform: translateY(-1px) }`
triggers on a tap on touch devices (false hover).

**C. Nav-link hover is effectively dead, and snaps.** `.nav__links` sets
`opacity: .55` on the **container**, which flattens the group — so the per-link
`a:hover { opacity: 1 }` cannot brighten past the group's 55% and the hover barely
registers. There's also no transition. (Footer links have the same missing
transition, without the group-opacity bug.)

```css
/* services/site/index.html:162-163 — current */
.nav__links { display: flex; gap: 32px; font-size: 17px; opacity: .55; }
.nav__links a:hover { opacity: 1; color: #fff; }
```
```css
/* services/site/index.html:483-484 — current */
.footer__col a { display: block; color: rgba(255,255,255,.7); font-size: 17px; margin-bottom: 12px; }
.footer__col a:hover { color: #fff; }
```

## Target

**A + B.** Give `.btn` press feedback and move the hover motion behind a
hover-capable media query. Exclude the disabled "Coming Soon" pass button (which
deliberately overrides its hover to `translateY(0)` at `services/site/index.html:406`).

```css
/* target — replace the .btn transition + .btn:hover rule */
.btn {
  /* …unchanged declarations… */
  transition: transform 160ms var(--ease-out), filter var(--dur-fast) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
}
.btn:active { transform: translateY(-1px) scale(0.97); }
.pass .btn:active { transform: none; }   /* keep the disabled CTA inert */
```

**C.** Move the dim onto the anchors so the hover actually brightens, and ease it
(hover → `ease`, per the playbook):

```css
/* target — replace lines 162-163 */
.nav__links { display: flex; gap: 32px; font-size: 17px; }
.nav__links a { opacity: .55; transition: opacity var(--dur-fast) ease, color var(--dur-fast) ease; }
.nav__links a:hover { opacity: 1; color: #fff; }
```
```css
/* target — add a transition to footer links (line 483) */
.footer__col a { display: block; color: rgba(255,255,255,.7); font-size: 17px; margin-bottom: 12px; transition: color var(--dur-fast) ease; }
```

## Repo conventions to follow

- Press-feedback value from the playbook: `transform: scale(0.97)` on `:active`
  with a ~160ms ease-out transition. Keep it subtle.
- Hover-gating exemplar pattern: `@media (hover: hover) and (pointer: fine)`.
- Link hovers are color/opacity (not movement), so they stay ungated — only the
  button's `transform` hover is gated.

## Steps

1. In `.btn` (`services/site/index.html:109`), swap the `transition` line for the
   token-based one in **Target A**.
2. Replace the bare `.btn:hover { … }` rule (line 111) with the `@media (hover:hover)
   and (pointer:fine)` wrapper around it.
3. Immediately after, add `.btn:active { transform: translateY(-1px) scale(0.97); }`
   and `.pass .btn:active { transform: none; }`.
4. Replace `services/site/index.html:162-163` with the three-rule block in **Target C**
   (dim + transition moved to `.nav__links a`).
5. Add `transition: color var(--dur-fast) ease;` to `.footer__col a` (line 483).

## Boundaries

- Do NOT change markup/structure — CSS only.
- Do NOT alter `.pass .btn` / `.pass .btn:hover` (lines 405-406) beyond adding the
  `:active { transform: none }` guard.
- Do NOT add dependencies.
- If any cited line drifted since commit c73cd2c, STOP and report.

## Verification

- **Mechanical**: none (no build).
- **Feel check**:
  - Press-and-hold a Download button → it dips to ~97% and springs back on release;
    the dip is quick (160ms), not sluggish.
  - The "Coming Soon" pass button does **not** dip when pressed.
  - Hover a nav link → it **visibly brightens** from grey to white over ~150ms
    (before this fix it barely changed). Confirm the same easing on footer links.
  - In DevTools → Animations, set playback to 10% and confirm the press scales from
    center and never overshoots below 0.97.
  - On a touch device (or DevTools device mode), tap a button → no lingering lift.
- **Done when**: buttons have a subtle press, the disabled CTA is exempt, and nav
  links brighten smoothly on hover.
