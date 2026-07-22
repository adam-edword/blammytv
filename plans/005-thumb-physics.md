# 005 — Unify sliding-thumb physics; take the Toggle off layout properties

- **Status**: TODO
- **Commit**: 018a8f4
- **Severity**: HIGH (frequency) / MEDIUM (risk-adjusted)
- **Category**: Performance / Cohesion & tokens
- **Estimated scope**: ui.css only (Toggle conversion + curve unification); optional measured follow-up for ChipTabs

## Problem

Three sliding-thumb primitives, three different physics, two on layout properties:

1. **Toggle** — `apps/app/src/styles/ui.css:92`: the thumb animates `left` (2px→24px; small variant 2px→18px), a layout-triggering property, on every flip:

```css
/* ui.css:84-96 — current */
.toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-chip);
  background: #ffffff;
  border: 0.5px solid rgba(0, 0, 0, 0.12);
  transition: left 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
.toggle--on .toggle__thumb { left: 24px; }
/* …ui.css:90-92 (--sm): */
.toggle--sm.toggle--on .toggle__thumb { left: 18px; }
```

2. **ChipTabs thumb** — `ui.css:40-42`: animates `left` AND `width` 220ms on the Material curve, on 100+/day surfaces (settings tabs, header Stream rail, playlist sub-tabs).
3. **Mode rail indicator** — `live.css:113-115`: `transform` + `width` 380ms `var(--spring)` — the only `--spring` user, and the only one with spring feel.

Same interaction, three behaviors; two of them do layout work per frame.

## Target

**Toggle: full transform conversion** (fixed-size thumb — unambiguous win):

```css
/* target — ui.css */
.toggle__thumb {
  /* …unchanged declarations, left stays 2px… */
  transition: transform 260ms var(--spring);
}
.toggle--on .toggle__thumb { transform: translateX(22px); }
.toggle--sm.toggle--on .toggle__thumb { transform: translateX(16px); }
```

(Deltas: 24 − 2 = 22px; 18 − 2 = 16px. Delete the `left` overrides; `transition: left …` becomes `transition: transform …`.)

**ChipTabs: curve unification only — keep the left/width mechanism.** The inline `left`/`width` positioning is load-bearing: a ResizeObserver in `ChipTabs.tsx:47-62` live-tracks width-morphing chips (the header search chip morphs width while focused, and "a width-morphing chip drags the thumb with it" — documented in `ChipTabs.tsx:28-31`). A transform/FLIP conversion would fight that tracking. The verified fix here is cohesion, not mechanism:

```css
/* target — ui.css:40-42 */
transition:
  left 300ms var(--spring),
  width 300ms var(--spring);
```

This gives all three thumbs the same spring family. (Mode rail stays 380ms — its travel is much longer.)

**Layout-cost escalation path (measure first, per repo agreement):** if a DevTools Performance trace of chip switching on the Live screen (video playing) shows Layout entries above ~2ms per frame attributable to the thumb, file a follow-up to FLIP-convert ChipTabs (instant inline left/width + inverted transform that transitions to identity, recomputed on each ResizeObserver tick). Do NOT do it in this plan.

## Repo conventions to follow

- `--spring` pairing guidance: `tokens.css:61-62` ("pair with ~380ms") — shorter travels take shorter durations; 260ms (toggle) and 300ms (chips) keep the overshoot readable without lag.
- The existing spring exemplar to imitate: `live.css:113-115`.
- The reduced-motion gate at `ui.css:142-146` already covers `.chip-tabs__thumb` and `.toggle__thumb` — keep it working (it targets `transition`, which survives these edits as `transition: none`).

## Steps

1. `styles/ui.css` — Toggle conversion exactly as the target block (three rules touched, two `left` overrides deleted).
2. `styles/ui.css:40-42` — ChipTabs thumb: swap `220ms cubic-bezier(0.4, 0, 0.2, 1)` → `300ms var(--spring)` on both properties.
3. Run the Performance trace described above; paste the result (max Layout ms/frame during a chip switch) into this file under a "## Trace result" heading and set Status accordingly.

## Boundaries

- Do NOT touch `ChipTabs.tsx` or `Toggle.tsx`.
- Do NOT convert ChipTabs to transforms/FLIP in this plan.
- Do NOT touch the mode rail (`live.css`).
- Do NOT change thumb sizes, colors, borders, or the track transitions (`.toggle` background 220ms ease stays).

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app lint`; `grep -n "left 2" apps/app/src/styles/ui.css` shows `left: 2px` still present exactly twice (base thumb positions), and `grep -n "transition: left" styles/ui.css` returns nothing.
- **Feel check** (Animations panel at 10%):
  - Toggle: thumb glides with a slight overshoot and settle; flipping rapidly retargets mid-flight, never jumps.
  - Toggle `--sm` variant lands exactly at its old resting spot (18px visual left edge).
  - ChipTabs (settings tabs + header rail): thumb now lands with the same spring settle as the Live mode rail; focus the header search — the thumb still tracks the chip's width morph live.
  - Reduced motion emulated: both thumbs snap instantly (existing gate).
- **Done when**: all four feel checks pass and the trace result is recorded.
