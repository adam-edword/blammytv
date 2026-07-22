# 007 — Hold-to-clear: show the hold's progress

- **Status**: TODO
- **Commit**: 018a8f4
- **Severity**: MEDIUM
- **Category**: Missed opportunity / Interruptibility (asymmetric timing)
- **Estimated scope**: StreamScreen.tsx (~5 lines) + stream.css (~20 lines)

## Problem

Clearing a Continue Watching card is a **1000ms destructive hold with no progress indication**. `apps/app/src/features/stream/StreamScreen.tsx:1771-1783`:

```tsx
const start = () => {
  held.current = false;
  setHolding(true);
  timer.current = window.setTimeout(() => {
    held.current = true;
    setHolding(false);
    onClear();
  }, 1000);
};
```

While holding, `.continue-card--holding` only dims the art and fades in a static "Keep holding" overlay (`stream.css:400-412`, `transition: opacity 250ms ease`). The user can't see how long is left or that anything is filling — this is the textbook case where an animation carries actual information. The current press/release timing is also symmetric (release = same 250ms fade), where the playbook wants deliberate phases slow and the system's response snappy.

## Target

A progress bar that fills linearly over exactly the timer's 1000ms via a **transition** (not a keyframe — transitions retarget, so releasing early retreats from the current fill instead of vanishing):

```css
/* stream.css — new, next to the .continue-card--holding rules (~line 395) */
.continue-card__holdbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  z-index: 2;
  background: var(--accent);
  transform: scaleX(0);
  transform-origin: 0 50%;
  /* release: quick retreat — the system's response snaps */
  transition: transform 200ms var(--ease-out);
  pointer-events: none;
}
.continue-card--holding .continue-card__holdbar {
  transform: scaleX(1);
  /* the deliberate phase: fill tracks the 1000ms timer exactly */
  transition: transform 1000ms linear;
}
```

`linear` is correct here (constant progress = honest countdown; playbook: constant motion → linear). `var(--ease-out)` from plan 004 (or the literal `cubic-bezier(0.23, 1, 0.32, 1)`).

TSX — one line inside the existing artwrap (which already establishes the positioning box, `stream.css:420`):

```tsx
<span className="continue-card__holdbar" aria-hidden />
```

Reduced motion: **keep the fill** — it's information, not decoration (playbook: reduced motion keeps transitions that aid comprehension). No gate.

## Repo conventions to follow

- The card already uses accent-colored progress UI: the watched-progress bar inside `.continue-card__artwrap` — place the holdbar in the same positioning box and imitate that bar's markup style (find it directly below `stream.css:420`).
- `aria-hidden` on purely visual spans: see `ChipTabs.tsx:74`.

## Steps

1. `features/stream/StreamScreen.tsx` — inside the continue-card's artwrap JSX (component at ~1760-1800), add the holdbar span.
2. `styles/stream.css` — add the two rules above near the `.continue-card--holding` block.
3. Confirm the 1000ms in CSS and the `setTimeout(…, 1000)` agree; add a one-line comment on the CSS rule: `/* must match the 1000ms hold timer in StreamScreen */`.

## Boundaries

- Do NOT change the hold duration, the timer logic, or `onClear`.
- Do NOT use a keyframe animation for the fill.
- Do NOT restyle the existing holding overlay text or dim.

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app typecheck` + `lint`.
- **Feel check**:
  - Press and hold a Continue Watching card: an accent bar fills the bottom edge over exactly one second; the clear fires as it reaches full.
  - Release at ~half: the bar retreats quickly (200ms) from half — it must NOT snap to zero or continue filling.
  - Press again immediately after releasing: the fill restarts from wherever the retreat has reached (transition retargeting) — acceptable and correct, since the timer also restarts; the visual never exceeds the timer.
  - Reduced motion emulated: the fill still animates (deliberate — it carries the countdown).
- **Done when**: hold-fill and release-retreat both behave as above and the clear still fires at exactly 1s.
