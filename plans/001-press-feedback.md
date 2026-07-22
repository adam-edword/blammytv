# 001 — Add press feedback to every pressable surface

- **Status**: TODO
- **Commit**: 018a8f4
- **Severity**: HIGH
- **Category**: Physicality & origin (press feedback)
- **Estimated scope**: 9 CSS files, ~30 small rule additions, no TSX changes

## Problem

The entire app has exactly **one** `:active` rule — `apps/app/src/styles/onboarding.css:265` (`.onb-btn:active`). Every other pressable surface acknowledges hover but not the press itself, so clicks feel like they land on glass. This matters most where the response has real latency (tuning a channel takes a beat — the press feedback is the only instant acknowledgment the UI can give) and on the highest-frequency surfaces (EPG cells, channel cards, chip tabs).

Representative current state (all hover-only):

```css
/* apps/app/src/styles/live.css:717 — current (.guide__cell) */
  transition: filter 120ms ease;
}
.guide__cell:hover {
  filter: brightness(1.25);
}
```

```css
/* apps/app/src/styles/ui.css:129 — current (.btn-primary) */
  transition: filter 150ms ease, opacity 150ms ease;
}
.btn-primary:hover:not(:disabled) {
  filter: brightness(1.35);
}
```

## Target

The playbook press-feedback pattern: `transform: scale(0.97)` on `:active` with a 160ms strong ease-out, kept subtle (0.95–0.98). Scale **down** only — shrinking never clips inside scroll boxes (relevant: `themes.css:39-40` documents that a hover *translate* got clipped by the settings body's scroll box; scale-down is safe there).

Two sizes:

```css
/* small controls (chips, buttons, swatches, toggle): */
:active { transform: scale(0.97); }
/* large cards (posters, guide cards/cells, theme cards): */
:active { transform: scale(0.98); }
```

Every element that gains a transform on `:active` must also carry `transform` in its `transition` list at `160ms var(--ease-out)` (token from plan 004; if 004 hasn't run yet, use the literal `cubic-bezier(0.23, 1, 0.32, 1)`).

Elements that already hover-lift keep the lift but compose it with the press, e.g. Discover genre cards (hover `translateY(-3px)` at `discover.css:44`):

```css
.genre-card:active { transform: translateY(-1px) scale(0.98); }
```

## Repo conventions to follow

- The one existing exemplar to imitate: `apps/app/src/styles/onboarding.css:265` (`.onb-btn:active`).
- Selectors stay flat, one component block per file section, comments only where a constraint isn't visible in the code (see any styles/*.css file for tone).
- Disabled states must not press: always `:active:not(:disabled)` where a `:disabled` style exists (e.g. `.btn-primary`, `.player__btn`).

## Steps

Each step: add `transform` to the element's existing `transition` list (create one if absent) and add the `:active` rule directly below the element's hover rule.

1. `styles/ui.css` — `.chip-tabs__tab:active` → `scale(0.97)`; `.toggle:active .toggle__thumb` → `scale(0.94)` (thumb dips while pressed; it's 26px, needs a deeper dip to read); `.btn-primary:active:not(:disabled)` → `scale(0.97)`.
2. `styles/live.css` — `.guide__cell:active` → `scale(0.98)`; `.guide__card:active` → `scale(0.98)`; `.mode-rail__chip:active` → `scale(0.97)`; `.live-collapse:active`, `.live-status__retry:active`, `.guide__fav:active` → `scale(0.97)` (for `.guide__fav` use `scale(0.9)` — tiny icon buttons need a deeper dip to be visible).
3. `styles/player.css` — `.player__btn:active:not(:disabled)`, `.overlay__btn:active`, `.theater-live:active`, `.tune__retry:active`, `.skip-chip:active` → `scale(0.97)`.
4. `styles/base.css` — `.header__tab:active` → `scale(0.97)`; `.update-chip:active` → `scale(0.97)`.
5. `styles/stream.css` — `.stream-card:active .stream-card__tilt` → `scale(0.98)` (the tilt wrapper owns transforms; pressing the outer card must not fight react-parallax-tilt's inline transform — put the press on `.stream-card__tilt`'s parent scale via a wrapper-safe rule; if the Tilt inline style wins the cascade, apply the press to `.stream-card` itself instead and verify visually). `.continue-card:active` → `translateY(-1px) scale(0.98)` (hover is `translateY(-3px)` at line 384). `.vod-source:active`, `.episode-card:active`, `.season-chip:active`, `.vod-back:active` → `scale(0.97)`.
6. `styles/discover.css` — `.genre-card:active` → `translateY(-1px) scale(0.98)`.
7. `styles/settings.css` — `.settings__close:active`, `.accent-swatch:active` → `scale(0.9)` (small icons); other settings pressables listed at settings.css:278 area → `scale(0.97)`. Respect `settings.css:309-311`: `.accent-custom .accent-swatch` has `transform: none` on hover on purpose — give it **no** press scale either.
8. `styles/themes.css` — `.tcard:active .tcard__art` → `scale(0.98)`; `.theme-pill__seg:active`, `.themes-launch:active` → `scale(0.98)`.
9. `styles/onboarding.css` — `.onb-swatch:active` → `scale(0.97)` (matches the existing `.onb-btn:active` exemplar at line 265).

## Boundaries

- Do NOT touch TSX files.
- Do NOT change hover styles, colors, or layout — add `:active` rules and extend `transition` lists only.
- Do NOT add press feedback to non-interactive elements or to `.accent-custom .accent-swatch` (documented exception).
- Do NOT add new dependencies.
- If a selector named here doesn't exist at roughly the cited location, STOP and report instead of improvising.

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app lint` and `pnpm --filter @blammytv/app typecheck` pass (CSS-only change; both should be unaffected).
- **Feel check**: run the app (`pnpm dev`), then:
  - Click and HOLD a guide cell: it visibly dips to 98% and stays dipped until release.
  - Click a chip tab rapidly: the dip retargets smoothly (transitions, not keyframes — no restart-from-zero).
  - Press `.btn-primary` while disabled: nothing moves.
  - Hover a Discover genre card, then press: card settles from -3px to -1px + 98%, not a jump to origin.
  - Poster card: press must not visually fight the tilt — if the card judders, apply the fallback in step 5.
- **Done when**: every surface listed in steps 1–9 dips on press, holds while pressed, and springs back on release; nothing presses while disabled.
