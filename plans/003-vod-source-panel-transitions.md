# 003 — Make the VOD source panel interruptible, with a real exit

- **Status**: TODO
- **Commit**: 018a8f4
- **Severity**: MEDIUM
- **Category**: Interruptibility / Easing & duration / Missed opportunity
- **Estimated scope**: 2 files (stream.css + StreamScreen.tsx), ~40 lines

## Problem

Three confirmed findings on the same drawer (the in-playback source panel, tens/day):

1. **One-shot keyframe, not interruptible** — `apps/app/src/styles/stream.css:1172`: the panel enters via `animation: vod-panel-in 260ms cubic-bezier(0.3, 0.05, 0.2, 1);`. Keyframes restart from zero; reversible UI should use transitions that retarget mid-flight.
2. **Wrong easing** — `cubic-bezier(0.3, 0.05, 0.2, 1)` has initial slope ≈ 0.17 (ease-in-out shaped). Entrances should start fast (ease-out); the panel perceptibly lags the click.
3. **Exit teleports** — `StreamScreen.tsx` mounts it with `{panelOpen && …}` (line ~909, `.vod-panel` at 923); closing (click-away backdrop, ✕, or picking a source) unmounts a 420px glass panel in one frame.

```css
/* apps/app/src/styles/stream.css:1172-1188 — current */
  animation: vod-panel-in 260ms cubic-bezier(0.3, 0.05, 0.2, 1);
}
@keyframes vod-panel-in {
  from { transform: translateX(40px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .vod-panel { animation: none; }
}
```

## Target

Transition-based open/close with a brief keep-mounted closing state. Enter 260ms on the iOS drawer curve; exit 180ms ease-out (both directions ease-out per the playbook: entering or exiting → ease-out; the drawer curve is the entrance's stronger flavor).

```css
/* target — stream.css */
.vod-panel {
  /* …existing declarations, animation line REMOVED… */
  transition:
    transform 260ms var(--ease-drawer),
    opacity 260ms var(--ease-drawer);
}
@starting-style {
  .vod-panel { transform: translateX(40px); opacity: 0; }
}
.vod-panel--closing {
  transform: translateX(40px);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 180ms var(--ease-out),
    opacity 180ms var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  /* keep a fade so a full-height panel doesn't hard-cut (playbook: reduced
     motion keeps comprehension aids, drops movement) */
  .vod-panel, .vod-panel--closing { transition: opacity 200ms ease; }
  @starting-style { .vod-panel { transform: none; } }
  .vod-panel--closing { transform: none; }
}
```

Tokens (from plan 004, or inline literals): `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`, `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.

TSX: replace the boolean unmount with a three-state close.

```tsx
/* target — StreamScreen.tsx, replacing the current `panelOpen: boolean` usage */
const [panelState, setPanelState] = useState<"open" | "closing" | null>(null);
const openPanel = () => setPanelState("open");
const closePanel = () => setPanelState((s) => (s === "open" ? "closing" : s));
/* render: */
{panelState && (
  <div
    className={"vod-panel" + (panelState === "closing" ? " vod-panel--closing" : "")}
    data-interactive
    onTransitionEnd={(e) => {
      if (panelState === "closing" && e.target === e.currentTarget) setPanelState(null);
    }}
  >
```

Reopening while closing must retarget: `openPanel` sets `"open"` and the transition reverses from wherever it is — that's the interruptibility win.

## Repo conventions to follow

- The `.vod-panel__backdrop` (StreamScreen.tsx:919) should fade with the same states: `opacity` 260ms in / 180ms out, and get `pointer-events: none` while closing.
- State naming in StreamScreen already favors small local `useState` + handlers; follow the existing `panelOpen` call sites (search `setPanelOpen` and replace each: `setPanelOpen(true)` → `openPanel()`, `setPanelOpen(false)` → `closePanel()`).
- Comment style: one line on the non-obvious part only (the closing keep-mounted state).

## Steps

1. `features/stream/StreamScreen.tsx` — replace `panelOpen` boolean state with `panelState` as above; update every `setPanelOpen` call site; add `onTransitionEnd` unmount; apply the `--closing` class to both `.vod-panel` and `.vod-panel__backdrop`.
2. `styles/stream.css` — delete the `vod-panel-in` keyframes and the `animation:` line; add the transition + `@starting-style` + `.vod-panel--closing` rules; update the reduced-motion block at 1184 per the target (fade-only, not `none`).
3. Add matching `.vod-panel__backdrop` fade rules (currently it has no transition).

## Boundaries

- Do NOT touch any other panel or overlay (002 owns entrances elsewhere).
- Do NOT change what closes the panel or the panel's contents/layout.
- Do NOT add a dependency or a generic "useDelayedUnmount" abstraction — inline the three-state pattern.
- If `panelOpen` has grown more call sites than the ones found by search, migrate them all or STOP and report.

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app typecheck` and `lint` pass; `grep -c "vod-panel-in" apps/app/src/styles/stream.css` returns 0.
- **Feel check** (DevTools Animations panel at 10%):
  - Open: panel starts moving immediately on click (no perceptible lag — that's the ease-out fix).
  - Close: panel slides out in 180ms; backdrop fades with it; clicks pass through while closing.
  - Spam open/close rapidly: the panel reverses mid-flight from its current position — never jumps to an endpoint or restarts from off-screen.
  - Reduced motion emulated: open/close are opacity fades, no horizontal movement.
- **Done when**: all four feel checks pass and the keyframe is gone.
